import { APT_INSTALL, commandExists, runLogged } from '../system.ts'
import type { LogFn, SetupContext, Step, StepResult } from '../types.ts'

function step(id: string, label: string, run: Step['run']): Step {
  return { id, label, group: 'docker', run }
}

export function dockerSteps(): Step[] {
  return [
    step('docker', 'Docker', installDocker),
    step('nomad', 'Project NOMAD', installNomad),
    step('postgres', 'PostgreSQL', (ctx, log) => ensureContainer(ctx, log, 'postgres', [
      '--restart=always',
      '-e', 'POSTGRES_USER=admin',
      '-e', 'POSTGRES_PASSWORD=admin',
      '-e', 'POSTGRES_DB=postgres',
      '-p', '5432:5432',
      'postgres',
    ])),
    step('mysql', 'MySQL', (ctx, log) => ensureContainer(ctx, log, 'mysql', [
      '--restart=always',
      '-e', 'MYSQL_ROOT_PASSWORD=root',
      '-e', 'MYSQL_DATABASE=meubanco',
      '-e', 'MYSQL_USER=admin',
      '-e', 'MYSQL_PASSWORD=admin',
      '-p', '3306:3306',
      'mysql',
    ])),
    step('redis', 'Redis', (ctx, log) => ensureContainer(ctx, log, 'redis', ['--restart=always', '-p', '6379:6379', 'redis'])),
  ]
}

async function installDocker(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  log('Instalando Docker...')
  let failed = false
  if (await commandExists(ctx, 'docker')) {
    const version = await ctx.shell('docker --version || true')
    log(`Docker já instalado: ${version.lines[0] ?? ''}`)
  } else {
    const script = await runLogged(ctx, log, 'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh')
    await ctx.shell('rm -f /tmp/get-docker.sh')
    if (!script && !(await commandExists(ctx, 'docker'))) {
      log('get.docker.com falhou; tentando apt...')
      if (!(await runLogged(ctx, log, `${APT_INSTALL} docker.io docker-compose-v2`))) {
        log('Falha ao instalar docker via apt.')
        failed = true
      }
    }
  }
  if (!(await dockerReady(ctx, log))) {
    log('Docker daemon indisponível — contêineres podem falhar.')
    failed = true
  } else {
    log('Docker daemon OK.')
  }
  log(`Adicionando ${ctx.realUser} ao grupo docker (sem newgrp — faça logout/login)...`)
  await runLogged(ctx, log, 'getent group docker >/dev/null 2>&1 || groupadd docker || true')
  if (!(await runLogged(ctx, log, `usermod -aG docker ${shellUser(ctx.realUser)}`))) failed = true
  return failed ? 'warn' : 'ok'
}

function shellUser(user: string): string {
  return `'${user.replaceAll("'", `'\\''`)}'`
}

async function dockerReady(ctx: SetupContext, log: LogFn): Promise<boolean> {
  if ((await ctx.shell('docker info >/dev/null 2>&1')).code === 0) return true
  log('Docker daemon não responde; tentando iniciar...')
  await runLogged(ctx, log, 'command -v systemctl >/dev/null 2>&1 && systemctl start docker || true')
  await runLogged(ctx, log, 'command -v systemctl >/dev/null 2>&1 && systemctl enable docker || true')
  if ((await ctx.shell('docker info >/dev/null 2>&1')).code === 0) return true
  if (!(await commandExists(ctx, 'dockerd'))) return false
  log('Iniciando dockerd em background (sem systemd)...')
  await runLogged(ctx, log, `mkdir -p /var/run /var/log
dockerd >/tmp/dockerd-setup.log 2>&1 &
for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done`)
  return (await ctx.shell('docker info >/dev/null 2>&1')).code === 0
}

async function installNomad(ctx: SetupContext, log: LogFn): Promise<StepResult> {
  if (ctx.skipNomad) {
    log('SKIP_NOMAD=1 — pulando Project NOMAD.')
    return 'ok'
  }
  if ((await ctx.shell('docker info >/dev/null 2>&1')).code !== 0) {
    log('Docker daemon indisponível — pulando Project NOMAD.')
    return 'warn'
  }
  if ((await ctx.shell('test -f /opt/project-nomad/compose.yml')).code === 0) {
    log('Project NOMAD já instalado; subindo a stack...')
    const ok = await runLogged(ctx, log, 'docker compose -p project-nomad -f /opt/project-nomad/compose.yml up -d')
    if (ok) log('Command Center: http://localhost:8080')
    else log('Falha ao subir Project NOMAD (continuando).')
    return ok ? 'ok' : 'warn'
  }
  log('Instalando Project NOMAD (https://www.projectnomad.us/)...')
  const downloaded = await runLogged(ctx, log, 'curl -fsSL https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/main/install/install_nomad.sh -o /tmp/install_nomad.sh')
  if (!downloaded) {
    log('Não foi possível baixar o instalador do Project NOMAD (continuando).')
    return 'warn'
  }
  const ok = await runLogged(ctx, log, 'bash /tmp/install_nomad.sh', { input: 'y\ny\n' })
  await ctx.shell('rm -f /tmp/install_nomad.sh')
  if (ok) log('Project NOMAD instalado. Command Center: http://localhost:8080')
  else log('Falha ao instalar Project NOMAD (continuando).')
  return ok ? 'ok' : 'warn'
}

async function ensureContainer(ctx: SetupContext, log: LogFn, name: string, args: string[]): Promise<StepResult> {
  log(`Iniciando contêiner ${name}...`)
  if ((await ctx.shell('docker info >/dev/null 2>&1')).code !== 0) {
    log('Docker daemon indisponível — pulando contêiner.')
    return 'warn'
  }
  const quoted = args.map(shellUser).join(' ')
  const script = `
name=${shellUser(name)}
if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    echo "Contêiner $name já está em execução."
  else
    echo "Reiniciando contêiner existente: $name"
    docker start "$name"
  fi
else
  echo "Criando contêiner $name..."
  docker run -d --name "$name" ${quoted}
fi
`
  const ok = await runLogged(ctx, log, script)
  if (!ok) log(`Falha ao criar ${name}`)
  return ok ? 'ok' : 'warn'
}
