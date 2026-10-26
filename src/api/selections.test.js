import { describe, expect, it } from 'vitest'
import { diffSelection } from './selections.js'

describe('diffSelection', () => {
  const snapshot = [
    { personId: 1, note: 'a' },
    { personId: 2, note: '' },
    { personId: 3, note: 'c' },
  ]

  it('vráti len pridané, odobraté a zmenené poznámky', () => {
    const items = [
      { personId: 1, note: 'a' },
      { personId: 3, note: 'zmenená' },
      { personId: 4, note: '' },
    ]
    const d = diffSelection(snapshot, items)
    expect(d.added.map((i) => i.personId)).toEqual([4])
    expect(d.removed).toEqual([2])
    expect(d.notes).toEqual([{ personId: 3, note: 'zmenená' }])
    expect(d.hasChanges).toBe(true)
  })

  it('bez zmien nič neposiela', () => {
    expect(diffSelection(snapshot, snapshot).hasChanges).toBe(false)
  })

  it('akceptuje aj tvar zo servera (person_id) a ignoruje duplicity', () => {
    const d = diffSelection([{ person_id: 1, note: null }], [{ personId: 1, note: '' }, { personId: 1, note: '' }])
    expect(d.hasChanges).toBe(false)
  })
})
