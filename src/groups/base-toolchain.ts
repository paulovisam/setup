import path from 'node:path'
import {
  APT_INSTALL,
  appendBashrc,
  ensureUserWritable,
  pathExists,
  runLogged,
  shellQuote,
  writeText,
} from '../system.ts'
import type { LogFn, SetupContext, Step, StepResult } from '../types.ts'

function step(id: string, label: string, run: Step['run']): Step {
  return { id, label, group: 'base', run }
}

async function finish(failed: boolean): Promise<StepResult> {
  return failed ? 'warn' : 'ok'
}

export function toolchainSteps(): Step[] {
  return [
    step('dns', 'DNS Cloudflare', installDns),
    step('mise', 'mise', installMise),
    step('node', 'Node.js', installNode),
    step('python', 'Python', installPython),
    step('poetry', 'Poetry', installPoetry),
    step('java', 'Java', installJava),
  ]
}

async function installDns(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Configurando DNS Cloudflare (1.1.1.3, 1.0.0.3)...')
  try {
    await writeText('/etc/systemd/resolved.conf.d/dns.conf', '[Resolve]\nDNS=1.1.1.3 1.0.0.3\n')
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 'warn'
  }
  if (!(await runLogged(ctx, log, 'systemctl restart systemd-resolved'))) {
    log('systemd-resolved indisponível neste ambiente; DNS via resolved.conf.d foi escrito mesmo assim.')
  }
  if ((await ctx.shell('command -v nmcli >/dev/null 2>&1')).code === 0) {
    await runLogged(ctx, log, `while IFS= read -r uuid; do
      [ -z "$uuid" ] && continue
      nmcli connection modify "$uuid" ipv4.ignore-auto-dns yes || true
      nmcli connection modify "$uuid" ipv4.dns "1.1.1.3 1.0.0.3" || true
    done < <(nmcli -t -f UUID connection show 2>/dev/null || true)`)
  }
  return 'ok'
}

async function installMise(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando mise...')
  await ensureUserWritable(ctx)
  let failed = false
  if (ctx.realUser === 'root') {
    failed = !(await runLogged(ctx, log, 'curl -fsSL https://mise.run | sh'))
  } else {
    const asUser = await runLogged(ctx, log, 'curl -fsSL https://mise.run | sh', { asUser: true })
    if (!asUser) {
      log('mise como usuário falhou; tentando como root...')
      failed = !(await runLogged(ctx, log, 'curl -fsSL https://mise.run | sh'))
    }
  }
  if (!(await promoteMise(ctx))) {
    log('mise não encontrado após install.')
    failed = true
  } else {
    await runLogged(ctx, log, 'chown root:root /usr/local/bin/mise; chmod 755 /usr/local/bin/mise')
    await ensureUserWritable(ctx)
    if (!(await runLogged(ctx, log, '/usr/local/bin/mise --version'))) failed = true
  }
  await writeText('/etc/profile.d/mise.sh', 'eval "$(/usr/local/bin/mise activate bash)"\n')
  await runLogged(ctx, log, 'chmod +x /etc/profile.d/mise.sh')
  await appendBashrc(ctx, 'eval "$(/usr/local/bin/mise activate bash)"')
  await appendBashrc(ctx, "alias cls='clear'")
  await appendBashrc(ctx, 'export PATH="$HOME/.local/bin:$PATH"')
  await appendBashrc(ctx, 'export PATH="$HOME/.opencode/bin:$PATH"')
  return finish(failed)
}

async function promoteMise(ctx: SetupContext): Promise<boolean> {
  if (await pathExists(ctx, '/root/.local/bin/mise', '-x')) {
    return runLogged(ctx, () => {}, 'mv /root/.local/bin/mise /usr/local/bin/mise')
  }
  const userBin = path.join(ctx.realHome, '.local/bin/mise')
  if (await pathExists(ctx, userBin, '-x')) {
    return runLogged(ctx, () => {}, `cp ${shellQuote(userBin)} /usr/local/bin/mise`)
  }
  const found = await ctx.shell('command -v mise || true')
  const bin = found.lines.map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  if (!bin) return false
  return runLogged(ctx, () => {}, `cp ${shellQuote(bin)} /usr/local/bin/mise`)
}

async function installNode(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Node.js via mise...')
  await ensureUserWritable(ctx)
  let failed = false
  for (const version of ['22', '18']) {
    if (!(await runLogged(ctx, log, `mise i node@${version}`, { asUser: true }))) {
      log(`Falha mise node@${version} (continuando).`)
      failed = true
    }
  }
  if (!(await runLogged(ctx, log, 'mise use --global node@22', { asUser: true }))) {
    log('Falha mise use node@22.')
    failed = true
  }
  return finish(failed)
}

async function installPython(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Python via mise...')
  await runLogged(ctx, log, `${APT_INSTALL} -qq build-essential curl ca-certificates`)
  let failed = false
  for (const version of ['3.12', '3.10']) {
    if (!(await runLogged(ctx, log, `mise i python@${version}`, { asUser: true }))) {
      log(`Falha mise python@${version} (continuando).`)
      failed = true
    }
  }
  if (!(await runLogged(ctx, log, 'mise use --global python@3.12', { asUser: true }))) {
    log('Falha mise use python@3.12.')
    failed = true
  }
  return finish(failed)
}

async function installPoetry(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Poetry...')
  let failed = false
  if (!(await runLogged(ctx, log, 'curl -sSL https://install.python-poetry.org | POETRY_HOME=/opt/poetry python3 - --yes'))) {
    log('Falha ao instalar Poetry.')
    failed = true
  }
  await runLogged(ctx, log, 'ln -sf /opt/poetry/bin/poetry /usr/local/bin/poetry')
  if (!(await runLogged(ctx, log, 'poetry --version'))) {
    log('poetry não disponível no PATH.')
    failed = true
  }
  return finish(failed)
}

async function installJava(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Java via mise...')
  let failed = false
  if (!(await runLogged(ctx, log, 'mise i java@17', { asUser: true }))) {
    log('Falha mise java@17 (continuando).')
    failed = true
  }
  if (!(await runLogged(ctx, log, 'mise use --global java@17', { asUser: true }))) {
    log('Falha mise use java@17.')
    failed = true
  }
  return finish(failed)
}
