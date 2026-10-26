import { describe, expect, it } from 'vitest'
import { CURRENT_SELECTION_STORAGE_KEY, UNDO_LIMIT, initialState, readStored, reducer, toItems } from './currentSelectionReducer.js'

function run(...actions) {
  return actions.reduce(reducer, initialState)
}

const ids = (state) => state.items.map((i) => i.personId)

describe('košík — pridávanie a odoberanie', () => {
  it('toggle pridá a druhým klikom odoberie', () => {
    expect(ids(run({ type: 'toggle', personId: 1 }))).toEqual([1])
    expect(ids(run({ type: 'toggle', personId: 1 }, { type: 'toggle', personId: 1 }))).toEqual([])
  })

  it('add neduplikuje ani v rámci jedného volania a zachová poradie', () => {
    const s = run({ type: 'add', personIds: [3, 1] }, { type: 'add', personIds: [1, 2, 2] })
    expect(ids(s)).toEqual([3, 1, 2])
  })

  it('add/remove bez zmeny nevytvorí záznam v histórii', () => {
    const s1 = run({ type: 'add', personIds: [1] })
    expect(reducer(s1, { type: 'add', personIds: [1] })).toBe(s1)
    expect(reducer(s1, { type: 'remove', personIds: [9] })).toBe(s1)
  })

  it('poznámka sa viaže na osobu v košíku a nemení históriu', () => {
    const s = run({ type: 'add', personIds: [1, 2] }, { type: 'note', personId: 2, note: 'výborná energia' })
    expect(s.items.find((i) => i.personId === 2).note).toBe('výborná energia')
    expect(s.history).toHaveLength(1)
  })
})

describe('košík — krok späť', () => {
  it('vyprázdnenie sa dá vrátiť vrátane poznámok a viazaného výberu', () => {
    const loaded = run(
      { type: 'load', selection: { id: 5, name: 'Klub 19. 8.' }, items: [{ person_id: 1, note: 'A' }, { person_id: 2 }] },
      { type: 'clear' },
    )
    expect(loaded.items).toEqual([])
    expect(loaded.loaded).toBeNull()
    const back = reducer(loaded, { type: 'undo' })
    expect(back.items).toEqual([{ personId: 1, note: 'A' }, { personId: 2, note: '' }])
    expect(back.loaded.id).toBe(5)
  })

  it('história je obmedzená a undo na prázdnej histórii nič nerobí', () => {
    let s = initialState
    for (let i = 0; i < UNDO_LIMIT + 5; i++) s = reducer(s, { type: 'toggle', personId: i })
    expect(s.history).toHaveLength(UNDO_LIMIT)
    expect(reducer(initialState, { type: 'undo' })).toBe(initialState)
  })

  it('clear prázdneho košíka nevytvorí históriu', () => {
    expect(reducer(initialState, { type: 'clear' })).toBe(initialState)
  })
})

describe('košík — uložené výbery', () => {
  it('saved nastaví nový snapshot bez záznamu do histórie', () => {
    const s = run({ type: 'add', personIds: [1] }, { type: 'saved', selection: { id: 9, name: 'X' }, items: [{ personId: 1 }] })
    expect(s.loaded).toMatchObject({ id: 9, name: 'X', project_name: '', subtitle: '', snapshot: [{ personId: 1, note: '' }] })
    expect(s.history).toHaveLength(1)
  })

  it('detach zruší väzbu, položky ostanú', () => {
    const s = run({ type: 'load', selection: { id: 1, name: 'A' }, items: [{ person_id: 4 }] }, { type: 'detach' })
    expect(s.loaded).toBeNull()
    expect(ids(s)).toEqual([4])
  })
})

describe('košík — vlastník a odhlásenie', () => {
  it('prvé priradenie vlastníka košík zachová', () => {
    const s = run({ type: 'add', personIds: [1] }, { type: 'owner', owner: 'u1' })
    expect(ids(s)).toEqual([1])
    expect(s.owner).toBe('u1')
  })

  it('iný používateľ košík nezdedí a nemôže ho vrátiť cez späť', () => {
    const s = run({ type: 'owner', owner: 'u1' }, { type: 'add', personIds: [1, 2] }, { type: 'owner', owner: 'u2' })
    expect(s.items).toEqual([])
    expect(s.owner).toBe('u2')
    expect(reducer(s, { type: 'undo' }).items).toEqual([])
  })

  it('reset vymaže všetko vrátane histórie', () => {
    const s = run({ type: 'owner', owner: 'u1' }, { type: 'add', personIds: [1] }, { type: 'reset' })
    expect(s).toEqual(initialState)
  })
})

describe('košík — perzistencia', () => {
  function storage(value) {
    return { getItem: (k) => (k === CURRENT_SELECTION_STORAGE_KEY ? value : null) }
  }

  it('načíta uložený stav a odfiltruje poškodené položky', () => {
    const raw = JSON.stringify({ items: [{ personId: 1, note: 'x' }, { personId: 'zlé' }, null], loaded: null, owner: 'u1' })
    expect(readStored(storage(raw))).toEqual({ items: [{ personId: 1, note: 'x' }], loaded: null, history: [], owner: 'u1' })
  })

  it('poškodené alebo nedostupné úložisko neshodí aplikáciu', () => {
    expect(readStored(storage('{nie json'))).toBeNull()
    expect(readStored(storage(JSON.stringify({ items: 'x' })))).toBeNull()
    expect(readStored({ getItem: () => { throw new Error('SecurityError') } })).toBeNull()
    expect(readStored(undefined)).toBeNull()
  })

  it('toItems prijme formát z databázy aj z aplikácie', () => {
    expect(toItems([{ person_id: 1, note: null }, { personId: 2, note: 'a' }])).toEqual([
      { personId: 1, note: '' },
      { personId: 2, note: 'a' },
    ])
  })
})
