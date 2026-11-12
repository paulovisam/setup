import path from 'node:path'
import {
  APT_INSTALL,
  appendBashrc,
  chownPath,
  commandExists,
  ensureUserWritable,
  pathExists,
  runLogged,
  shellQuote,
} from '../system.ts'
import type { LogFn, SetupContext, Step, StepResult } from '../types.ts'

const NPM_APPS = ['yarn', 'next'] as const

const AGENTS = [
  ['Claude Code', 'curl -fsSL https://claude.ai/install.sh | bash', 'claude --version'],
  ['Codex', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', 'codex --version'],
  ['Cursor CLI', 'curl -fsS https://cursor.com/install | bash', 'agent --version'],
  ['Antigravity CLI', 'curl -fsSL https://antigravity.google/cli/install.sh | bash', 'agy --version'],
  ['OpenCode', 'curl -fsSL https://opencode.ai/v2/install | bash', 'opencode --version'],
] as const

const APT_APPS = ['ffmpeg', 'flameshot', 'diodon', 'btop', 'folder-color', 'gnome-sushi', 'mysql-client'] as const

function step(id: string, label: string, run: Step['run']): Step {
  return { id, label, group: 'base', run }
}

export function packageSteps(): Step[] {
  return [
    step('npm', 'npm global', installNpm),
    step('agents', 'CLIs de coding agents', installAgents),
    step('apt', 'Pacotes apt', installApt),
    step('brightness', 'Brilho do monitor', installBrightness),
    step('yt-dlp', 'yt-dlp', installYtDlp),
    step('zoxide', 'Zoxide', installZoxide),
    step('gh', 'GitHub CLI', installGh),
  ]
}

async function installNpm(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando pacotes npm globais (yarn evita o pacote apt/cmdtest)...')
  if (await debInstalled(ctx, 'yarn')) log("Pacote apt 'yarn' detectado — pode ser cmdtest. Prefira 'npm i -g yarn' (mise/npm).")
  if (await debInstalled(ctx, 'cmdtest')) log("Pacote apt 'cmdtest' detectado — o binário 'yarn' do cmdtest NÃO é o Yarn JS. Considere: apt-get remove -y cmdtest")
  if (!(await commandExists(ctx, 'npm', true))) {
    log('npm não encontrado; pulando pacotes npm globais.')
    return 'warn'
  }
  let failed = false
  for (const pkg of NPM_APPS) {
    log(`Instalando ${pkg}...`)
    if (!(await runLogged(ctx, log, `npm install --global ${pkg}`, { asUser: true }))) {
      log(`Falha ao instalar pacote npm: ${pkg} (continuando).`)
      failed = true
      continue
    }
    if (!(await runLogged(ctx, log, `${pkg} --version`, { asUser: true }))) {
      log(`${pkg} global instalado, mas '${pkg} --version' falhou no PATH do usuário.`)
      failed = true
    }
  }
  return failed ? 'warn' : 'ok'
}

async function debInstalled(ctx: SetupContext, name: string): Promise<boolean> {
  const result = await ctx.shell(`dpkg -l ${shellQuote(name)} 2>/dev/null | awk '/^ii/ {print $2}' | grep -qx ${shellQuote(name)}`)
  return result.code === 0
}

async function installAgents(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando CLIs de coding agents...')
  await ensureUserWritable(ctx)
  let failed = false
  for (const [name, install, verify] of AGENTS) {
    log(`Instalando ${name}...`)
    if (!(await runLogged(ctx, log, install, { asUser: true }))) {
      log(`Falha ao instalar ${name} (continuando).`)
      failed = true
      continue
    }
    if (!(await runLogged(ctx, log, verify, { asUser: true }))) {
      log(`${name} instalado, mas verificação falhou (continuando).`)
      failed = true
    } else {
      log(`${name} OK.`)
    }
  }
  await ensureUserWritable(ctx)
  return failed ? 'warn' : 'ok'
}

async function installApt(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Adicionando repositórios...')
  let failed = false
  await runLogged(ctx, log, 'apt-get update -qq || true')
  await runLogged(ctx, log, `${APT_INSTALL} -qq software-properties-common ca-certificates curl wget gnupg apt-transport-https`)
  if (!(await runLogged(ctx, log, 'add-apt-repository ppa:diodon-team/stable -y'))) log('PPA diodon indisponível neste sistema.')
  if (!(await runLogged(ctx, log, 'add-apt-repository ppa:tomtomtom/yt-dlp -y'))) log('PPA yt-dlp indisponível neste sistema.')
  log('Instalando pacotes apt...')
  await runLogged(ctx, log, 'apt-get update -qq || true')
  for (const app of APT_APPS) {
    log(`Instalando ${app}...`)
    if (!(await runLogged(ctx, log, `${APT_INSTALL} ${app}`))) {
      log(`Falha ao instalar pacote apt: ${app} (continuando).`)
      failed = true
    }
  }
  return failed ? 'warn' : 'ok'
}

async function installBrightness(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Configurando brilho automático do monitor...')
  const ok = await runLogged(ctx, log, 'curl -fsSL https://gist.githubusercontent.com/paulovisam/5da0ad203685feceecd0ec1d00ff02b8/raw/828810791009c827e37a3b825b42d163257b73d2/monitor-brilho.sh | bash')
  if (!ok) log('Falha ao configurar brilho automático do monitor (continuando).')
  return ok ? 'ok' : 'warn'
}

async function installYtDlp(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando yt-dlp...')
  const ok = await runLogged(ctx, log, 'wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp')
  return ok ? 'ok' : 'warn'
}

async function installZoxide(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Zoxide...')
  let installed = false
  const downloaded = await runLogged(ctx, log, 'curl -fsSL --retry 2 --retry-delay 2 https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh -o /tmp/zoxide-install.sh')
  if (!downloaded) log('Não foi possível baixar install.sh do Zoxide (rede/GitHub).')
  else if (await runLogged(ctx, log, 'sh /tmp/zoxide-install.sh')) {
    installed = true
    log('Zoxide instalado via install.sh oficial.')
  } else {
    log('install.sh do Zoxide falhou (possível rate limit do GitHub).')
  }
  await ctx.shell('rm -f /tmp/zoxide-install.sh')

  if (!installed) {
    log('Tentando Zoxide via apt...')
    if (await runLogged(ctx, log, `${APT_INSTALL} zoxide`)) {
      installed = true
      log('Zoxide instalado via apt.')
    } else {
      log('apt não conseguiu instalar zoxide.')
    }
  }

  if (!installed && await runLogged(ctx, log, 'command -v mise >/dev/null && mise install zoxide && mise use --global zoxide', { asUser: true })) {
    const bin = await findZoxide(ctx)
    if (bin) {
      const dest = path.join(ctx.realHome, '.local/bin/zoxide')
      if (bin !== dest) {
        await runLogged(ctx, log, `mkdir -p ${shellQuote(path.dirname(dest))} && cp ${shellQuote(bin)} ${shellQuote(dest)}`)
        await chownPath(ctx, dest)
      }
      installed = true
      log(`Zoxide obtido via mise (${bin}).`)
    } else {
      log('mise instalou zoxide, mas binário não encontrado.')
    }
  } else if (!installed) {
    log('Fallback mise para zoxide também falhou.')
  }

  if (await pathExists(ctx, '/root/.local/bin/zoxide', '-x') && ctx.realUser !== 'root') {
    const dest = path.join(ctx.realHome, '.local/bin/zoxide')
    await runLogged(ctx, log, `mkdir -p ${shellQuote(path.dirname(dest))} && cp /root/.local/bin/zoxide ${shellQuote(dest)}`)
    await chownPath(ctx, path.join(ctx.realHome, '.local'), true)
  }

  if (!installed) {
    log('Zoxide não pôde ser instalado (continuando sem abortar o script).')
    return 'warn'
  }
  await appendBashrc(ctx, 'eval "$(zoxide init bash)"')
  log('Zoxide configurado no bashrc.')
  return 'ok'
}

async function findZoxide(ctx: SetupContext): Promise<string> {
  const candidates = [
    path.join(ctx.realHome, '.local/share/mise/shims/zoxide'),
    path.join(ctx.realHome, '.local/bin/zoxide'),
    '/usr/local/bin/zoxide',
  ]
  for (const candidate of candidates) {
    if (await pathExists(ctx, candidate, '-x')) return candidate
  }
  const found = await ctx.shell('command -v zoxide || true', { asUser: true })
  return found.lines.map((line) => line.trim()).find((line) => line.length > 0) ?? ''
}

async function installGh(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando GitHub CLI (gh)...')
  if (!(await runLogged(ctx, log, `${APT_INSTALL} gh`))) {
    log('Falha ao instalar gh (continuando).')
    return 'warn'
  }
  const version = await ctx.shell('gh --version | head -n1')
  log(`gh instalado: ${version.lines[0] ?? 'ok'}`)
  log('Faça login no GitHub CLI após o setup: gh auth login')
  return 'ok'
}
