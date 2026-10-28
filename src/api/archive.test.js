// Archív v demo režime: duplicity, prepojenie, tvar odpovedí, pravidlá názvov.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_LIST_COLUMNS } from './archive.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

let db
let api
let plan

beforeAll(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('BroadcastChannel', undefined)
  db = await import('./local/db.js')
  api = await import('./archive.js')
  plan = await import('../lib/aliasPlan.js')
})

beforeEach(() => {
  db.resetDemoDb()
  db.setSessionUserId('demo-caster')
})

const base = { shoot_date: '2026-01-02', production_name: 'Rýchly prachy', role_name: 'Čašník' }

describe('duplicity', () => {
  it('presná duplicita sa nepozerá na veľkosť písmen ani diakritiku', async () => {
    await api.createAppearances([{ raw_name: 'Test Človek', ...base, person_id: 10, match_status: 'confirmed' }])
    const [dup] = await api.checkDuplicates([{ raw_name: 'iné', ...base, production_name: 'RYCHLY PRACHY', role_name: 'čašník', person_id: 10 }])
    expect(dup.exact).toBeTruthy()
    await expect(
      api.createAppearances([{ raw_name: 'iné', ...base, production_name: 'RÝCHLY PRACHY', role_name: 'čašník', person_id: 10 }]),
    ).rejects.toThrow(/existuje/)
  })

  it('ten istý záznam raz nepriradený a raz prepojený sa nahlási ako sameRecord', async () => {
    await api.createAppearances([{ raw_name: 'Jan Novak', ...base, person_id: 10, match_status: 'confirmed' }])
    const [dup] = await api.checkDuplicates([{ raw_name: 'Ján Novák', ...base }])
    expect(dup.exact).toBeNull()
    expect(dup.sameRecord).toHaveLength(1)
  })

  it('prepojenie, ktoré vytvorí duplicitu, dá zrozumiteľnú hlášku', async () => {
    const [a] = await api.createAppearances([{ raw_name: 'Jan Novak', ...base, person_id: 10, match_status: 'confirmed' }])
    const [b] = await api.createAppearances([{ raw_name: 'J. Novák', ...base }])
    expect(a.id).not.toBe(b.id)
    await expect(api.linkAppearance(b.id, 10)).rejects.toThrow(/rovnakú postavu — záznam je duplicitný/)
  })
})

describe('tvar odpovedí', () => {
  it('zoznam aj úprava vracajú rovnaké stĺpce bez original_*', async () => {
    const [row] = await api.listAppearances()
    expect(Object.keys(row).sort()).toEqual([...APPEARANCE_LIST_COLUMNS].sort())
    const updated = await api.updateAppearance(row.id, { role_name: 'Kuchár' })
    expect(Object.keys(updated).sort()).toEqual([...APPEARANCE_LIST_COLUMNS].sort())
    const full = await api.getAppearance(row.id)
    expect(full.original_role_name).toBe(row.role_name)
  })
})

describe('pravidlá názvov', () => {
  it('hromadná zmena je atomická a dá sa vrátiť', async () => {
    const before = await api.listNameValues('role')
    const changes = plan.planMerge(before, ['Okoloidúci', 'okoloidúci', 'Okoloiduci'], 'Okoloidúci')
    await api.applyAliasChanges('role', changes)
    const rows = (await api.listAppearances()).filter((r) => r.role_name === 'Okoloiduci')
    expect(rows.every((r) => r.role_effective === 'Okoloidúci')).toBe(true)

    await api.applyAliasChanges('role', plan.invertChanges(changes))
    const restored = await api.listNameValues('role')
    expect(restored.map((x) => [x.raw_value, x.alias?.canonical_value ?? null])).toEqual(
      before.map((x) => [x.raw_value, x.alias?.canonical_value ?? null]),
    )
  })

  it('reťazec A→B→C sa odmietne a nič sa neuloží', async () => {
    const count = db.getDb().role_aliases.length
    await expect(
      api.applyAliasChanges('role', [
        { raw_value: 'Pacient', rule: { canonical_value: 'pacient', is_excluded: false } },
        { raw_value: 'pacient', rule: { canonical_value: 'Hosť na svadbe', is_excluded: false } },
      ]),
    ).rejects.toThrow(/reťazec/)
    expect(db.getDb().role_aliases.length).toBe(count)
  })

  it('viewer pravidlá meniť nesmie', async () => {
    db.setSessionUserId('demo-viewer')
    await expect(
      api.applyAliasChanges('role', [{ raw_value: 'Pacient', rule: { canonical_value: 'X', is_excluded: false } }]),
    ).rejects.toThrow(/oprávnenie/)
  })
})
