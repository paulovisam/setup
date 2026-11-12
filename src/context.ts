import { readFile } from 'node:fs/promises'
import { shellQuote } from './system.ts'
import type { SetupContext, ShellFn, SkipFlags } from './types.ts'

export type OsRelease = { id: string; versionId: string }
export type ArchInfo = { debArch: 'amd64' | 'arm64'; grokPlatform: 'linux-x64' | 'linux-arm64' }
export type Identity = { realUser: string; realHome: string }

export function parseOsRelease(text: string): OsRelease {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return { id: values.ID ?? '', versionId: values.VERSION_ID ?? '' }
}

export function isUbuntu2404(os: { osId: string; osVersionId: string }): boolean {
  return os.osId === 'ubuntu' && os.osVersionId === '24.04'
}

export function detectArch(machine: string): ArchInfo {
  if (machine === 'aarch64' || machine === 'arm64') {
    return { debArch: 'arm64', grokPlatform: 'linux-arm64' }
  }
  return { debArch: 'amd64', grokPlatform: 'linux-x64' }
}

export function readSkipFlags(env: NodeJS.ProcessEnv): SkipFlags {
  return {
    skipGui: env.SKIP_GUI === '1',
    skipFlatpak: env.SKIP_FLATPAK === '1',
    skipNomad: env.SKIP_NOMAD === '1',
  }
}

export function isInteractive(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

export async function detectIdentity(shell: ShellFn, env: NodeJS.ProcessEnv): Promise<Identity> {
  const name = env.SUDO_USER?.trim() || env.USER?.trim() || 'root'
  if (name === 'root') return { realUser: 'root', realHome: '/root' }
  const result = await shell(`getent passwd ${shellQuote(name)} | cut -d: -f6`)
  const home = result.lines.map((line) => line.trim()).find((line) => line.length > 0) || `/home/${name}`
  return { realUser: name, realHome: home }
}

export async function loadContext(shell: ShellFn, identity: Identity, env: NodeJS.ProcessEnv = process.env): Promise<SetupContext> {
  let osText = ''
  try {
    osText = await readFile('/etc/os-release', 'utf8')
  } catch {
    osText = ''
  }
  const os = parseOsRelease(osText)
  return {
    ...identity,
    osId: os.id,
    osVersionId: os.versionId,
    ...detectArch(process.arch),
    ...readSkipFlags(env),
    shell,
  }
}
