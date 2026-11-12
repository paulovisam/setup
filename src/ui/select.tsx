import { useKeymap, useState } from '@termuijs/jsx'
import type { GroupId, SkipFlags } from '../types.ts'

export const GROUP_OPTIONS: { id: GroupId; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'gui', label: 'Interface gráfica' },
  { id: 'flatpak', label: 'Flatpak' },
  { id: 'docker', label: 'Docker' },
]

function lockedGroups(flags: SkipFlags): Set<GroupId> {
  const locked = new Set<GroupId>()
  if (flags.skipGui) locked.add('gui')
  if (flags.skipFlatpak) locked.add('flatpak')
  return locked
}

export function SelectScreen(props: { flags: SkipFlags; onSubmit: (groups: GroupId[]) => void }) {
  const locked = lockedGroups(props.flags)
  const [cursor, setCursor] = useState(0)
  const [checked, setChecked] = useState<GroupId[]>(
    GROUP_OPTIONS.map((item) => item.id).filter((id) => !locked.has(id)),
  )

  const toggle = () => {
    const current = GROUP_OPTIONS[cursor]
    if (!current || current.id === 'base' || locked.has(current.id)) return
    setChecked((prev) => (
      prev.includes(current.id) ? prev.filter((id) => id !== current.id) : [...prev, current.id]
    ))
  }

  useKeymap([
    { key: 'up', action: () => setCursor((value) => (value + GROUP_OPTIONS.length - 1) % GROUP_OPTIONS.length) },
    { key: 'down', action: () => setCursor((value) => (value + 1) % GROUP_OPTIONS.length) },
    { key: ' ', action: toggle },
    { key: 'space', action: toggle },
    {
      key: 'enter',
      action: () => {
        const groups = new Set<GroupId>(checked)
        groups.add('base')
        for (const id of locked) groups.delete(id)
        props.onSubmit([...groups])
      },
    },
  ])

  return (
    <col border="round" padding={1} flexGrow={1}>
      <text bold>Setup Linux</text>
      {GROUP_OPTIONS.map((group, index) => {
        const mark = checked.includes(group.id) ? '[x]' : '[ ]'
        const note = group.id === 'base' ? ' sempre' : locked.has(group.id) ? ' bloqueado' : ''
        const pointer = index === cursor ? '>' : ' '
        return <text key={group.id}>{`${pointer} ${mark} ${group.label}${note}`}</text>
      })}
      <text dim>espaço alterna · enter começa</text>
    </col>
  )
}
