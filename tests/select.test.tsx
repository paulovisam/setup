import { render } from '@termuijs/testing'
import { describe, expect, it } from 'vitest'
import { SelectScreen } from '../src/ui/select.tsx'

const flags = { skipGui: false, skipFlatpak: false, skipNomad: false }

describe('seleção', () => {
  it('mostra os quatro grupos', () => {
    const view = render(<SelectScreen flags={flags} onSubmit={() => {}} />, { width: 80, height: 24 })
    expect(view.getByText('Base')).toBeTruthy()
    expect(view.getByText('Interface gráfica')).toBeTruthy()
    expect(view.getByText('Flatpak')).toBeTruthy()
    expect(view.getByText('Docker')).toBeTruthy()
    view.unmount()
  })
})
