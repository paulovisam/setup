import type { Color } from '@termuijs/core'
import { BUILTIN_THEMES, ThemeEngine, ThemeProvider, tokyoNightTheme } from '@termuijs/tss'
import { Box, LogView, ProgressBar, ShortcutBar, TaskList, Text } from '@termuijs/widgets'
import type { TaskState } from '../types.ts'

export type RunView = {
  root: Box
  setTasks: (tasks: TaskState[]) => void
  setProgress: (done: number, total: number) => void
  log: (line: string) => void
  setShortcuts: (items: { key: string; label: string }[]) => void
}

function hex(value: string): Color {
  return { type: 'hex', hex: value }
}

export function createRunView(total: number): RunView {
  applyTokyoNight()
  const theme = tokyoNightTheme
  const root = new Box({
    flexDirection: 'column',
    flexGrow: 1,
    width: '100%',
    height: '100%',
    padding: 1,
    gap: 1,
    border: 'round',
    borderColor: hex(theme.border),
    bg: hex(theme.bg),
    fg: hex(theme.fg),
  })
  const bar = new ProgressBar({ height: 1 }, {
    value: 0,
    showLabel: true,
    labelFormat: 'fraction',
    total: Math.max(total, 1),
    fillColor: hex(theme.primary),
  })
  const body = new Box({ flexDirection: 'row', flexGrow: 1, gap: 1 })
  const tasks = new TaskList({ flexGrow: 1, width: '40%' }, { wheelspin: true })
  const log = new LogView({ flexGrow: 2 }, {
    autoScroll: true,
    maxLines: 2000,
    highlight: {
      Falha: hex(theme.error),
      pulando: hex(theme.warning),
      OK: hex(theme.success),
    },
  })
  const shortcuts = new ShortcutBar([{ key: 'q', label: 'Parar ao fim do passo' }], { height: 1 })
  body.addChild(tasks)
  body.addChild(log)
  root.addChild(new Text('Setup Linux', { bold: true, fg: hex(theme.primary) }))
  root.addChild(bar)
  root.addChild(body)
  root.addChild(shortcuts)
  return {
    root,
    setTasks: (next) => tasks.setTasks(next),
    setProgress: (done, all) => bar.setValue(all === 0 ? 1 : done / all),
    log: (line) => log.appendLine(line),
    setShortcuts: (items) => shortcuts.setItems(items),
  }
}

function applyTokyoNight(): void {
  const source = BUILTIN_THEMES['tokyo-night']
  if (!source) return
  const engine = new ThemeEngine()
  engine.load(source)
  engine.setTheme('tokyo-night')
  ThemeProvider.setTheme(tokyoNightTheme)
}
