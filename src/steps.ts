import { baseSteps } from './groups/base.ts'
import { dockerSteps } from './groups/docker.ts'
import { flatpakSteps } from './groups/flatpak.ts'
import { guiSteps } from './groups/gui.ts'
import type { GroupId, RunHooks, RunSummary, SetupContext, SkipFlags, Step, TaskState } from './types.ts'

export function allSteps(): Step[] {
  return [...baseSteps(), ...guiSteps(), ...flatpakSteps(), ...dockerSteps()]
}

export function selectSteps(steps: readonly Step[], groups: readonly GroupId[], flags: SkipFlags): Step[] {
  const selected = new Set<GroupId>(groups)
  selected.add('base')
  if (flags.skipGui) selected.delete('gui')
  if (flags.skipFlatpak) selected.delete('flatpak')
  return steps.filter((item) => {
    if (!selected.has(item.group)) return false
    if (flags.skipNomad && item.id === 'nomad') return false
    return true
  })
}

export async function runSteps(steps: readonly Step[], ctx: SetupContext, hooks: RunHooks): Promise<RunSummary> {
  const tasks: TaskState[] = steps.map((item) => ({ id: item.id, label: item.label, status: 'pending' }))
  const publish = () => hooks.onTasks(tasks.map((item) => ({ ...item })))
  publish()
  let ok = 0
  let warn = 0
  for (let index = 0; index < steps.length; index += 1) {
    if (hooks.shouldAbort()) {
      hooks.onLog('Parada solicitada. Os passos seguintes não rodam.')
      return { ok, warn, aborted: true }
    }
    const current = steps[index]
    const task = tasks[index]
    if (!current || !task) continue
    task.status = 'running'
    publish()
    hooks.onLog(current.label)
    let result: 'ok' | 'warn'
    try {
      result = await current.run(ctx, hooks.onLog)
    } catch (error) {
      hooks.onLog(error instanceof Error ? error.message : String(error))
      result = 'warn'
    }
    if (result === 'ok') {
      ok += 1
      task.status = 'done'
    } else {
      warn += 1
      task.status = 'error'
    }
    publish()
  }
  return { ok, warn, aborted: false }
}

export function formatSummary(summary: RunSummary): string {
  const stop = summary.aborted ? ' Parada solicitada antes do fim.' : ''
  return [
    `Concluído. ok=${summary.ok} avisos=${summary.warn}.${stop}`,
    'Faça login no GitHub CLI após o setup: gh auth login',
    'Reinicie o sistema quando conveniente para aplicar o grupo docker e o GDM: sudo reboot',
  ].join('\n')
}
