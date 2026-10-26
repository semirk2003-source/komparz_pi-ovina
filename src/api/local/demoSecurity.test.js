// Demo vrstva musí vynucovať rovnaké pravidlá ako databáza (kapitola 4.4).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTACT_FIELDS } from '../../constants/polia.js'

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
let people

beforeAll(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
  // BroadcastChannel v Node drží proces nažive; v testoch ho nepotrebujeme.
  vi.stubGlobal('BroadcastChannel', undefined)
  db = await import('./db.js')
  people = await import('../people.js')
})

beforeEach(() => {
  db.setSessionUserId(null)
})

function loginAs(id) {
  db.setSessionUserId(id)
}

describe('prístup bez prihlásenia a neaktívny účet', () => {
  it('bez prihlásenia listPeople zlyhá', async () => {
    await expect(people.listPeople()).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('neaktívny účet nevidí nič', async () => {
    const d = db.getDb()
    d.app_users.push({ id: 'demo-inactive', email: 'x@demo.sk', role: 'admin', is_active: false })
    loginAs('demo-inactive')
    await expect(people.listPeople()).rejects.toMatchObject({ code: 'forbidden' })
    expect(() => db.requireStaff()).toThrow()
    d.app_users.pop()
  })
})

describe('viewer', () => {
  beforeEach(() => loginAs('demo-viewer'))

  it('listPeople nevracia telefón, e-mail ani adresu', async () => {
    const rows = await people.listPeople()
    expect(rows.length).toBeGreaterThan(0)
    for (const field of CONTACT_FIELDS) {
      expect(rows.some((r) => Object.hasOwn(r, field))).toBe(false)
    }
  })

  it('nesmie zapisovať ani spravovať', () => {
    expect(() => db.requireStaff()).toThrow(/oprávnenie/)
    expect(() => db.requireAdmin()).toThrow(/oprávnenie/)
    expect(db.isStaff()).toBe(false)
  })

  it('getPeopleContacts mu kontakty nevydá', async () => {
    if (typeof people.getPeopleContacts !== 'function') return
    await expect(people.getPeopleContacts([1, 2])).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('listPeople nevracia odkazy na interné objekty databázy', async () => {
    const rows = await people.listPeople()
    rows[0].first_name = 'ZMENENÉ'
    const fresh = await people.listPeople()
    expect(fresh[0].first_name).not.toBe('ZMENENÉ')
  })
})

describe('caster a admin', () => {
  it('caster smie zapisovať, ale nie spravovať', () => {
    loginAs('demo-caster')
    expect(() => db.requireStaff()).not.toThrow()
    expect(() => db.requireAdmin()).toThrow()
  })

  it('caster dostane kontakty cez getPeopleContacts', async () => {
    if (typeof people.getPeopleContacts !== 'function') return
    loginAs('demo-caster')
    const contacts = await people.getPeopleContacts([1])
    expect(contacts.get(1)).toHaveProperty('phone')
  })

  it('admin smie všetko', () => {
    loginAs('demo-admin')
    expect(() => db.requireAdmin()).not.toThrow()
  })
})

describe('zoznam a záznam zmien', () => {
  it('anonymizovaný profil sa v zozname nezobrazí', async () => {
    loginAs('demo-viewer')
    const d = db.getDb()
    const target = d.people[10]
    target.anonymized_at = new Date().toISOString()
    const rows = await people.listPeople()
    expect(rows.some((r) => r.id === target.id)).toBe(false)
    target.anonymized_at = null
  })

  it('audit zapisuje, kto zmenu urobil', () => {
    loginAs('demo-caster')
    const before = db.getDb().audit_log.length
    db.audit('people', 1, 'UPDATE', { phone: 'a' }, { phone: 'b' })
    const entry = db.getDb().audit_log.at(-1)
    expect(db.getDb().audit_log.length).toBe(before + 1)
    expect(entry).toMatchObject({ table_name: 'people', row_id: '1', changed_by: 'demo-caster' })
  })
})
