import { APT_INSTALL, commandExists, runLogged } from '../system.ts'
import type { LogFn, SetupContext, Step, StepResult } from '../types.ts'

const FLATPAK_APPS = [
  'com.google.Chrome',
  'com.discordapp.Discord',
  'com.mongodb.Compass',
  'org.pgadmin.pgadmin4',
  'io.dbeaver.DBeaverCommunity',
  'io.beekeeperstudio.Studio',
  'com.anydesk.Anydesk',
  'org.videolan.VLC',
  'rest.insomnia.Insomnia',
  'md.obsidian.Obsidian',
  'org.telegram.desktop',
  'com.valvesoftware.Steam',
  'com.heroicgameslauncher.hgl',
  'com.getpostman.Postman',
  'com.visualstudio.code',
  'org.localsend.localsend_app',
  'org.gnome.Boxes',
  'me.iepure.devtoolbox',
  'com.github.ADBeveridge.Raider',
  'io.github.jeffshee.Hidamari',
  'com.obsproject.Studio',
  'org.qbittorrent.qBittorrent',
  'it.mijorus.gearlever',
  'com.github.tchx84.Flatseal',
  'io.missioncenter.MissionCenter',
  'com.stremio.Stremio',
  'io.github.peazip.PeaZip',
  'com.github.wwmm.easyeffects',
  'io.github.alainm23.planify',
] as const

function step(id: string, label: string, run: Step['run']): Step {
  return { id, label, group: 'flatpak', run }
}

export function flatpakSteps(): Step[] {
  return [
    step('flatpak', 'Flatpak e aplicativos', installFlatpaks),
    step('dbx', 'DBX', installDbx),
  ]
}

async function installFlatpaks(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  let failed = false
  if (!(await commandExists(ctx, 'flatpak'))) {
    log('Instalando flatpak...')
    if (!(await runLogged(ctx, log, `${APT_INSTALL} flatpak`))) {
      log('Não foi possível instalar flatpak.')
      return 'warn'
    }
    await runLogged(ctx, log, 'flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo')
  }
  const already = await ctx.shell('dpkg -l 2>/dev/null | grep -q libreoffice || flatpak list 2>/dev/null | grep -q org.libreoffice.LibreOffice')
  if (already.code === 0) log('LibreOffice já está instalado.')
  else if (!(await runLogged(ctx, log, 'flatpak install flathub org.libreoffice.LibreOffice -y'))) {
    log('Falha ao instalar LibreOffice via Flatpak.')
    failed = true
  }
  log('Instalando pacotes Flatpak...')
  for (const app of FLATPAK_APPS) {
    log(`Instalando ${app}...`)
    if (!(await runLogged(ctx, log, `flatpak install flathub ${app} -y`))) {
      log(`Falha ao instalar Flatpak ${app} (continuando).`)
      failed = true
    }
  }
  return failed ? 'warn' : 'ok'
}

async function installDbx(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando DBX...')
  if (!(await commandExists(ctx, 'flatpak'))) {
    log('flatpak indisponível; pulando DBX.')
    return 'warn'
  }
  if (!(await runLogged(ctx, log, 'flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo'))) {
    log('Remote FlatPark indisponível (continuando).')
  }
  const ok = await runLogged(ctx, log, 'flatpak install flatpark com.dbxio.dbx -y')
  if (!ok) log('Falha ao instalar DBX (continuando).')
  return ok ? 'ok' : 'warn'
}
