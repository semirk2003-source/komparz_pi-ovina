import { describe, expect, it } from 'vitest'
import { AppError, fetchAllPages, toAppError } from './backend.js'

// Napodobenie PostgREST: range(from, to) vráti najviac `maxRows` riadkov.
function mockTable(total, maxRows) {
  const data = Array.from({ length: total }, (_, i) => ({ id: i + 1 }))
  const calls = []
  const buildQuery = () => ({
    range: async (from, to) => {
      calls.push([from, to])
      const end = Math.min(to + 1, from + maxRows, data.length)
      return { data: data.slice(from, Math.max(from, end)), error: null }
    },
  })
  return { buildQuery, calls }
}

function ids(rows) {
  return rows.map((r) => r.id)
}

describe('fetchAllPages', () => {
  it.each([
    [0, 1000],
    [1, 1000],
    [999, 1000],
    [1000, 1000],
    [1001, 1000],
    [5000, 1000],
    [12345, 1000],
    [5000, 500],
    [1200, 500],
    [500, 500],
    [499, 500],
    [7, 3],
  ])('%i riadkov pri limite servera %i načíta všetko presne raz', async (total, maxRows) => {
    const { buildQuery } = mockTable(total, maxRows)
    const rows = await fetchAllPages(buildQuery, 1000)
    expect(rows).toHaveLength(total)
    expect(ids(rows)).toEqual(Array.from({ length: total }, (_, i) => i + 1))
  })

  it('malá tabuľka stojí najviac dve požiadavky', async () => {
    const { buildQuery, calls } = mockTable(300, 1000)
    await fetchAllPages(buildQuery, 1000)
    expect(calls.length).toBeLessThanOrEqual(2)
  })

  it('pri limite 500 nesťahuje po stránkach väčších, než server vráti (bez dier)', async () => {
    const { buildQuery, calls } = mockTable(50000, 500)
    const rows = await fetchAllPages(buildQuery, 1000)
    expect(rows).toHaveLength(50000)
    expect(new Set(ids(rows)).size).toBe(50000)
    // 50 000 / 500 = 100 stránok + pár požiadaviek na koniec
    expect(calls.length).toBeLessThan(110)
  })

  it('chyba servera sa prenesie ako AppError', async () => {
    const buildQuery = () => ({ range: async () => ({ data: null, error: { code: '42501', message: 'x' } }) })
    await expect(fetchAllPages(buildQuery)).rejects.toBeInstanceOf(AppError)
    await expect(fetchAllPages(buildQuery)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('toAppError', () => {
  it('mapuje kódy PostgREST/Postgres na zrozumiteľné chyby', () => {
    expect(toAppError({ code: '23505' }).code).toBe('duplicate')
    expect(toAppError({ code: '23503' })).toMatchObject({
      code: 'missing_reference',
      message: 'Súvisiaci záznam medzitým niekto zmazal. Obnovte stránku.',
    })
    expect(toAppError({ code: '42501' }).code).toBe('forbidden')
    expect(toAppError({ code: 'PGRST301' }).code).toBe('auth')
    expect(toAppError({ code: 'PGRST116' }).code).toBe('not_found')
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network')
    const original = new AppError('x', 'y')
    expect(toAppError(original)).toBe(original)
  })
})
