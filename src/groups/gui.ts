import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isUbuntu2404 } from '../context.ts'
import { APT_INSTALL, chownPath, commandExists, githubReleaseUrl, installDeb, runLogged, shellQuote, writeText } from '../system.ts'
import type { LogFn, SetupContext, Step, StepResult } from '../types.ts'

function step(id: string, label: string, run: Step['run']): Step {
  return { id, label, group: 'gui', run }
}

function failed(ok: boolean): StepResult {
  return ok ? 'ok' : 'warn'
}

export function guiSteps(): Step[] {
  return [
    step('spotify', 'Spotify', installSpotify),
    step('rnd', 'React Native Debugger', installRnd),
    step('termius', 'Termius', installTermius),
    step('cursor', 'Cursor', installCursor),
    step('git-graph', 'Git Graph no Cursor', installGitGraph),
    step('solomd', 'SoloMD', (ctx, log) => installRelease(ctx, log, 'SoloMD', 'zhitongblog/solomd', `SoloMD_[^"\\s]*_${ctx.debArch}\\.deb`)),
    step('grok', 'Grok Bot', installGrok),
    step('maestri', 'Maestri', installMaestri),
    step('orca', 'Orca', installOrca),
    step('shortcuts', 'Atalhos GNOME', installShortcuts),
    step('flameshot', 'Flameshot', installFlameshot),
    step('wayland', 'Wayland desligado no GDM', disableWayland),
    step('nautilus', 'Reiniciar Nautilus', restartNautilus),
  ]
}

async function installSpotify(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  if (!isUbuntu2404(ctx)) {
    log(`Spotify/SpotX pulado: requer Ubuntu 24.04 (detectado: ID=${ctx.osId || 'desconhecido'} VERSION_ID=${ctx.osVersionId || 'desconhecido'}).`)
    return 'ok'
  }
  log('Instalando Spotify (SpotX) — Ubuntu 24.04 detectado...')
  const ok = await runLogged(ctx, log, 'bash <(curl -sSL https://spotx-official.github.io/run.sh) --installdeb --stable')
  if (!ok) log('Falha ao instalar Spotify (continuando).')
  return failed(ok)
}

async function installRnd(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando React Native Debugger...')
  const downloaded = await runLogged(ctx, log, 'wget -q https://github.com/jhen0409/react-native-debugger/releases/download/v0.14.0/react-native-debugger_0.14.0_amd64.deb -O /tmp/react-native-debugger.deb')
  if (!downloaded) {
    log('Download RND falhou.')
    return 'warn'
  }
  const ok = await runLogged(ctx, log, `dpkg -i /tmp/react-native-debugger.deb || ${APT_INSTALL} -f`)
  await ctx.shell('rm -f /tmp/react-native-debugger.deb')
  return failed(ok)
}

async function installTermius(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Termius...')
  const downloaded = await runLogged(ctx, log, 'wget -q https://www.termius.com/download/linux/Termius.deb -O /tmp/Termius.deb')
  if (!downloaded) {
    log('Download Termius falhou.')
    return 'warn'
  }
  const ok = await runLogged(ctx, log, `dpkg -i /tmp/Termius.deb || ${APT_INSTALL} -f`)
  await ctx.shell('rm -f /tmp/Termius.deb')
  if (!ok) log('Falha ao instalar Termius.')
  return failed(ok)
}

async function installCursor(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Cursor...')
  const ok = await runLogged(ctx, log, 'curl -s https://gist.githubusercontent.com/paulovisam/abc5cbbd187a101d90bd71c5e0fb0eba/raw/c52aa0bfc302e85ee2094c5adf8e346b60f8114b/install_cursor.sh | bash')
  if (!ok) log('Falha ao instalar Cursor.')
  return failed(ok)
}

async function installGitGraph(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando extensão Git Graph no Cursor (Open VSX)...')
  if (!(await pathExecutable(ctx, '/opt/cursor.appimage'))) {
    log('Cursor não encontrado em /opt/cursor.appimage; pulando Git Graph.')
    return 'warn'
  }
  const meta = await ctx.shell('curl -fsSL https://open-vsx.org/api/mhutchie/git-graph/latest')
  const url = meta.lines.join('\n').match(/"download":"(https:\/\/[^"]*\.vsix)"/)?.[1] ?? ''
  if (!url) {
    log('Não foi possível obter a URL do Git Graph no Open VSX (continuando).')
    return 'warn'
  }
  const dest = '/tmp/mhutchie.git-graph.vsix'
  if (!(await runLogged(ctx, log, `curl -fsSL ${shellQuote(url)} -o ${shellQuote(dest)}`))) {
    log('Download do Git Graph falhou (continuando).')
    return 'warn'
  }
  const ok = await runLogged(ctx, log, `env APPIMAGE_EXTRACT_AND_RUN=1 /opt/cursor.appimage --no-sandbox --install-extension ${shellQuote(dest)} --force`, { asUser: true })
  await ctx.shell(`rm -f ${shellQuote(dest)}`)
  if (ok) log('Git Graph instalado no Cursor.')
  else log('Falha ao instalar Git Graph no Cursor (continuando).')
  return failed(ok)
}

async function pathExecutable(ctx: SetupContext, file: string): Promise<boolean> {
  return (await ctx.shell(`test -x ${shellQuote(file)}`)).code === 0
}

async function installRelease(ctx: SetupContext, log: LogFn, name: string, repo: string, assetRegex: string): Promise<StepResult> {
  const url = await githubReleaseUrl(ctx, repo, assetRegex)
  return failed(await installDeb(ctx, log, name, url))
}

async function installGrok(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  const meta = await ctx.shell(`curl -fsSL ${shellQuote(`https://api2.cursor.sh/updates/api/download/stable/${ctx.grokPlatform}/sand`)}`)
  const url = meta.code === 0 ? meta.lines.join('\n').match(/"debUrl":"(https:\/\/[^"]*)"/)?.[1] ?? '' : ''
  return failed(await installDeb(ctx, log, 'Grok Bot', url))
}

async function installMaestri(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Maestri...')
  const ok = await runLogged(ctx, log, 'curl -fsSL https://themaestri.app/linux/script.sh | bash')
  if (!ok) log('Falha ao instalar Maestri (continuando).')
  return failed(ok)
}

async function installOrca(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  const url = await githubReleaseUrl(ctx, 'stablyai/orca', `orca-ide_[^"\\s]*_${ctx.debArch}\\.deb`)
  const ok = await installDeb(ctx, log, 'Orca', url)
  if (url && !(await runLogged(ctx, log, `${APT_INSTALL} libasound2t64 || ${APT_INSTALL} libasound2`))) {
    log('libasound indisponível; o Orca pode não abrir sem áudio.')
  }
  return failed(ok)
}

async function installShortcuts(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  if (!(await commandExists(ctx, 'gsettings'))) {
    log('Sem gsettings — pulando atalhos GNOME.')
    return 'ok'
  }
  log('Definindo atalhos de teclado...')
  const script = `
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/', '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name "flameshot" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command "flameshot gui" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding "<Shift><Super>s" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ name "diodon" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ command "/usr/bin/diodon" || true
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ binding "<Super>v" || true
gsettings set org.freedesktop.ibus.panel.emoji hotkey "@as []" || true
command -v ibus >/dev/null 2>&1 && ibus restart || true
`
  const ok = await runLogged(ctx, log, script, { asUser: true })
  if (!ok) log('gsettings falhou.')
  return failed(ok)
}

async function installFlameshot(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Configurando o FlameShot...')
  const dir = path.join(ctx.realHome, '.config/flameshot')
  try {
    await writeText(path.join(dir, 'flameshot.ini'), '[General]\ndrawColor=#ff0000\ndrawThickness=3\n')
    await chownPath(ctx, dir, true)
    return 'ok'
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 'warn'
  }
}

async function disableWayland(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  const file = '/etc/gdm3/custom.conf'
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    log('/etc/gdm3/custom.conf ausente — pulando desativação do Wayland.')
    return 'ok'
  }
  log('Desativando Wayland e usando Xorg...')
  let next = text.replaceAll('#WaylandEnable=false', 'WaylandEnable=false')
  if (!next.includes('WaylandEnable=false')) next = `${next}\nWaylandEnable=false\n`
  await writeFile(file, next)
  return 'ok'
}

async function restartNautilus(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  if (!(await commandExists(ctx, 'nautilus'))) return 'ok'
  log('Reiniciando Nautilus...')
  await runLogged(ctx, log, 'nautilus -q || true', { asUser: true })
  return 'ok'
}
