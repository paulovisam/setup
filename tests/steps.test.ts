import { describe, expect, it } from 'vitest'
import { allSteps, runSteps, selectSteps } from '../src/steps.ts'
import type { SetupContext, Step } from '../src/types.ts'

const open = { skipGui: false, skipFlatpak: false, skipNomad: false }

describe('passos', () => {
  it('mantém a base ligada e respeita SKIP_*', () => {
    const steps = allSteps()
    const onlyDocker = selectSteps(steps, ['docker'], open)
    expect(onlyDocker.some((item) => item.id === 'dns')).toBe(true)
    expect(onlyDocker.some((item) => item.group === 'gui')).toBe(false)

    const skipped = selectSteps(steps, ['base', 'gui', 'flatpak', 'docker'], {
      skipGui: true,
      skipFlatpak: true,
      skipNomad: true,
    })
    expect(skipped.some((item) => item.group === 'gui')).toBe(false)
    expect(skipped.some((item) => item.group === 'flatpak')).toBe(false)
    expect(skipped.some((item) => item.id === 'nomad')).toBe(false)
    expect(skipped.some((item) => item.id === 'postgres')).toBe(true)
    expect(skipped.findIndex((item) => item.id === 'docker')).toBeLessThan(skipped.findIndex((item) => item.id === 'postgres'))
  })

  it('marca erro e segue para o passo seguinte', async () => {
    const steps: Step[] = [
      { id: 'a', label: 'A', group: 'base', run: async () => 'ok' },
      { id: 'b', label: 'B', group: 'base', run: async () => { throw new Error('boom') } },
      { id: 'c', label: 'C', group: 'base', run: async () => 'ok' },
    ]
    const seen: string[] = []
    const summary = await runSteps(steps, {} as SetupContext, {
      onTasks: (tasks) => seen.push(tasks.map((task) => `${task.id}:${task.status}`).join(',')),
      onLog: () => {},
      shouldAbort: () => false,
    })
    expect(summary).toEqual({ ok: 2, warn: 1, aborted: false })
    expect(seen.at(-1)).toBe('a:done,b:error,c:done')
  })
})
