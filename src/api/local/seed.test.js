import { describe, expect, it, vi } from 'vitest'
import { generateSeed, SEED_VERSION } from './seed.js'
import { CLOTHING_SIZES, GENDERS, MATCH_STATUS, REGIONS } from '../../constants/polia.js'

// Prehliadače dávajú localStorage zhruba 5 MB (UTF-16 → ~5 mil. znakov).
const LOCAL_STORAGE_CHARS = 5 * 1024 * 1024

describe('generateSeed', () => {
  const seed = generateSeed(800)

  it('je deterministický (pri rovnakom dni)', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 12, 0, 0), toFake: ['Date'] })
    try {
      expect(JSON.stringify(generateSeed(50))).toBe(JSON.stringify(generateSeed(50)))
    } finally {
      vi.useRealTimers()
    }
  })

  it('má verziu a počítadlá id zodpovedajúce dátam', () => {
    expect(seed.version).toBe(SEED_VERSION)
    expect(seed.seq.people).toBe(Math.max(...seed.people.map((p) => p.id)))
    expect(seed.seq.appearances).toBe(Math.max(...seed.appearances.map((a) => a.id)))
    expect(seed.seq.person_photos).toBe(Math.max(...seed.person_photos.map((p) => p.id)))
  })

  it('hodnoty zodpovedajú povoleným hodnotám schémy', () => {
    for (const p of seed.people) {
      expect(GENDERS).toContain(p.gender)
      expect(REGIONS).toContain(p.region)
      expect(CLOTHING_SIZES).toContain(p.clothing_size)
      expect(p.height_cm).toBeGreaterThanOrEqual(40)
      expect(p.height_cm).toBeLessThanOrEqual(250)
      expect(p.shoe_size).toBeGreaterThanOrEqual(15)
      expect(p.shoe_size).toBeLessThanOrEqual(55)
    }
  })

  it('obsahuje menovcov (Diana Vranová dvakrát) ako rôzne osoby', () => {
    const dianas = seed.people.filter((p) => p.first_name === 'Diana' && p.last_name === 'Vranová')
    expect(dianas.length).toBeGreaterThanOrEqual(2)
    expect(new Set(dianas.map((p) => p.id)).size).toBe(dianas.length)
  })

  it('archív spĺňa pravidlá schémy (stav prepojenia, duplicity)', () => {
    const keys = new Set()
    for (const a of seed.appearances) {
      expect(Object.values(MATCH_STATUS)).toContain(a.match_status)
      if (a.match_status === MATCH_STATUS.UNMATCHED) expect(a.person_id).toBeNull()
      else expect(a.person_id).not.toBeNull()
      expect(a.original_role_name).toBe(a.role_name)
      const key = [a.person_id ?? `raw:${a.raw_name.toLowerCase()}`, a.shoot_date, (a.production_name || '').toLowerCase(), (a.role_name || '').toLowerCase()].join('|')
      expect(keys.has(key), `duplicita ${key}`).toBe(false)
      keys.add(key)
    }
  })

  it('menovci sa v archíve nikdy nepotvrdzujú automaticky', () => {
    const counts = new Map()
    for (const p of seed.people) {
      const k = `${p.first_name} ${p.last_name}`
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    const ambiguous = seed.appearances.filter((a) => (counts.get(a.raw_name) || 0) > 1)
    expect(ambiguous.length).toBeGreaterThan(0)
    expect(ambiguous.every((a) => a.match_status !== MATCH_STATUS.CONFIRMED)).toBe(true)
  })

  it('každá osoba má najviac 5 fotiek a najviac jednu hlavnú', () => {
    const byPerson = new Map()
    for (const ph of seed.person_photos) {
      const list = byPerson.get(ph.person_id) || []
      list.push(ph)
      byPerson.set(ph.person_id, list)
    }
    for (const list of byPerson.values()) {
      expect(list.length).toBeLessThanOrEqual(5)
      expect(list.filter((x) => x.is_primary).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('výkon a veľkosť demo dát', () => {
  it('predvolených 800 profilov sa zmestí do localStorage', () => {
    const size = JSON.stringify(generateSeed(800)).length
    expect(size).toBeLessThan(LOCAL_STORAGE_CHARS * 0.6)
  })

  it('5000 profilov: zmeria čas a veľkosť (test výkonu UI)', () => {
    const t0 = performance.now()
    const seed = generateSeed(5000)
    const ms = performance.now() - t0
    const size = JSON.stringify(seed).length
    console.info(
      `[seed 5000] generovanie ${ms.toFixed(0)} ms, JSON ${(size / 1024 / 1024).toFixed(2)} MB, ` +
        `archív ${seed.appearances.length} záznamov, fotky ${seed.person_photos.length}`,
    )
    expect(seed.people).toHaveLength(5000)
    expect(ms).toBeLessThan(3000)
  })
})
