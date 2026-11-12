import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useExeca } from '@termuijs/adapters'
import type { LogFn, SetupContext, ShellFn, ShellOptions, ShellResult } from './types.ts'

export const APT_INSTALL = 'apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold'

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function createShell(identity: { realUser: string; realHome: string }): ShellFn {
  const runner = useExeca({ env: { DEBIAN_FRONTEND: 'noninteractive' } })
  return async (script, options = {}) => runShell(runner, identity, script, options)
}

async function runShell(
  runner: ReturnType<typeof useExeca>,
  identity: { realUser: string; realHome: string },
  script: string,
  options: ShellOptions,
): Promise<ShellResult> {
  const prelude = options.asUser
    ? 'export PATH="$HOME/.local/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"\neval "$(/usr/local/bin/mise activate bash)" 2>/dev/null || true\n'
    : 'export PATH="/usr/local/bin:$PATH"\n'
  const full = `${prelude}${script}`
  const asUser = options.asUser === true && identity.realUser !== 'root'
  const argv = asUser
    ? ['sudo', '-u', identity.realUser, '-H', 'env', `HOME=${identity.realHome}`, 'bash', '-lc', full]
    : ['bash', '-lc', full]
  const file = argv[0]
  if (!file) return { code: 1, lines: [] }
  const lines: string[] = []
  const emit = (line: string) => {
    lines.push(line)
    if (line.length > 0) options.onLine?.(line)
  }
  try {
    const gen = runner.run(file, argv.slice(1), options.input === undefined ? {} : { input: options.input })
    for await (const line of gen) emit(line)
    return { code: 0, lines }
  } catch (error) {
    const code = exitCode(error)
    return { code: code === 0 ? 1 : code, lines }
  }
}

function exitCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'exitCode' in error) {
    const value = error.exitCode
    if (typeof value === 'number') return value
  }
  return 1
}

export async function runLogged(
  ctx: SetupContext,
  log: LogFn,
  script: string,
  options?: { asUser?: boolean; input?: string },
): Promise<boolean> {
  const result = await ctx.shell(script, { asUser: options?.asUser, input: options?.input, onLine: log })
  return result.code === 0
}

export async function commandExists(ctx: SetupContext, name: string, asUser = false): Promise<boolean> {
  const result = await ctx.shell(`command -v ${shellQuote(name)} >/dev/null 2>&1`, { asUser })
  return result.code === 0
}

export async function pathExists(ctx: SetupContext, file: string, flag: '-e' | '-x' | '-f' = '-e'): Promise<boolean> {
  const result = await ctx.shell(`test ${flag} ${shellQuote(file)}`)
  return result.code === 0
}

export async function writeText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

export async function chownPath(ctx: SetupContext, target: string, recursive = false): Promise<void> {
  if (ctx.realUser === 'root') return
  const flag = recursive ? '-R ' : ''
  await ctx.shell(`chown ${flag}${shellQuote(ctx.realUser)}:${shellQuote(ctx.realUser)} ${shellQuote(target)}`)
}

export async function ensureUserWritable(ctx: SetupContext): Promise<void> {
  const local = path.join(ctx.realHome, '.local')
  const cache = path.join(ctx.realHome, '.cache')
  await mkdir(path.join(local, 'bin'), { recursive: true })
  await mkdir(path.join(local, 'share'), { recursive: true })
  await mkdir(cache, { recursive: true })
  await chownPath(ctx, local, true)
  await chownPath(ctx, cache, true)
}

export async function appendBashrc(ctx: SetupContext, line: string): Promise<void> {
  const bashrc = path.join(ctx.realHome, '.bashrc')
  let current = ''
  try {
    current = await readFile(bashrc, 'utf8')
  } catch {
    current = ''
  }
  if (!current.split('\n').includes(line)) {
    const prefix = current.length === 0 || current.endsWith('\n') ? '' : '\n'
    await appendFile(bashrc, `${prefix}${line}\n`)
  }
  await chownPath(ctx, bashrc)
}

export async function githubReleaseUrl(ctx: SetupContext, repo: string, assetRegex: string): Promise<string> {
  const result = await ctx.shell(`curl -fsSL ${shellQuote(`https://api.github.com/repos/${repo}/releases/latest`)}`)
  if (result.code !== 0) return ''
  const match = result.lines.join('\n').match(new RegExp(`https://github.com/${repo}/releases/download/[^\\s"]*${assetRegex}`))
  return match?.[0] ?? ''
}

export async function installDeb(ctx: SetupContext, log: LogFn, name: string, url: string): Promise<boolean> {
  log(`Instalando ${name}...`)
  if (!url) {
    log(`URL do ${name} indisponível (continuando).`)
    return false
  }
  const dest = `/tmp/${name.replaceAll(/\s+/g, '-')}.deb`
  const downloaded = await runLogged(ctx, log, `curl -fsSL ${shellQuote(url)} -o ${shellQuote(dest)}`)
  if (!downloaded) {
    log(`Download de ${name} falhou (continuando).`)
    await ctx.shell(`rm -f ${shellQuote(dest)}`)
    return false
  }
  const installed = await runLogged(ctx, log, `dpkg -i ${shellQuote(dest)} || ${APT_INSTALL} -f`)
  await ctx.shell(`rm -f ${shellQuote(dest)}`)
  if (!installed) log(`Falha ao instalar ${name} (continuando).`)
  return installed
}
