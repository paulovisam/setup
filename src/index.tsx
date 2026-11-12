import { App } from '@termuijs/core'
import { getCurrentApp, render } from '@termuijs/jsx'
import { detectIdentity, isInteractive, loadContext } from './context.ts'
import { createShell } from './system.ts'
import { allSteps, formatSummary, runSteps, selectSteps } from './steps.ts'
import type { GroupId, SetupContext, Step } from './types.ts'
import { createRunView } from './ui/run.tsx'
import { SelectScreen } from './ui/select.tsx'

export async function main(): Promise<void> {
  if ((process.getuid?.() ?? 1) !== 0) {
    console.error('Você precisa de superpoderes (root) pra rodar este script')
    console.error('Execute: sudo ./script.sh')
    process.exit(1)
  }
  const rootShell = createShell({ realUser: 'root', realHome: '/root' })
  const identity = await detectIdentity(rootShell, process.env)
  const ctx = await loadContext(createShell(identity), identity, process.env)
  const everyGroup: GroupId[] = ['base', 'gui', 'flatpak', 'docker']

  if (!isInteractive()) {
    const summary = await runSteps(selectSteps(allSteps(), everyGroup, ctx), ctx, {
      onTasks: () => {},
      onLog: (line) => console.log(line),
      shouldAbort: () => false,
    })
    console.log(formatSummary(summary))
    return
  }

  const chosen = await pickGroups(ctx)
  if (!chosen) return
  const steps = selectSteps(allSteps(), chosen, ctx)
  await runInteractive(ctx, steps)
}

function pickGroups(ctx: SetupContext): Promise<GroupId[] | null> {
  let chosen: GroupId[] | null = null
  const screen = (
    <SelectScreen
      flags={ctx}
      onSubmit={(groups) => {
        chosen = groups
        getCurrentApp()?.exit(0)
      }}
    />
  )
  return render(screen, { title: 'Setup', fullscreen: true }).then(() => chosen)
}

async function runInteractive(ctx: SetupContext, steps: Step[]): Promise<void> {
  const view = createRunView(steps.length)
  let abort = false
  let finished = false
  const app = new App(view.root, { fullscreen: true, title: 'Setup', skipFallback: true })
  app.events.on('key', (event) => {
    if (event.key !== 'q') return
    if (finished) app.exit(0)
    else abort = true
  })
  const pending = app.mount()
  const summary = await runSteps(steps, ctx, {
    onTasks: (tasks) => {
      view.setTasks(tasks)
      const done = tasks.filter((task) => task.status === 'done' || task.status === 'error').length
      view.setProgress(done, tasks.length)
      app.requestRender()
    },
    onLog: (line) => {
      view.log(line)
      app.requestRender()
    },
    shouldAbort: () => abort,
  })
  finished = true
  for (const line of formatSummary(summary).split('\n')) view.log(line)
  view.setShortcuts([{ key: 'q', label: 'Sair' }])
  app.requestRender()
  await pending
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
