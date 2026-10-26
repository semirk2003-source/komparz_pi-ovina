import { describe, expect, it } from 'vitest'
import {
  computeAge, countLabel, formatAge, formatDate, fullName, nameWithId, normalizeText,
  parseDate, photoAgeLabel, pluralize,
} from './format.js'

describe('computeAge', () => {
  const today = new Date(2026, 9, 26) // 26. 10. 2026

  it('počíta celé roky a rešpektuje, či už boli narodeniny', () => {
    expect(computeAge('1990-10-26', today)).toBe(36)
    expect(computeAge('1990-10-27', today)).toBe(35)
    expect(computeAge('1990-10-25', today)).toBe(36)
  })

  it('zvládne batoľatá a chýbajúci či nezmyselný dátum', () => {
    expect(computeAge('2025-11-01', today)).toBe(0)
    expect(computeAge(null, today)).toBeNull()
    expect(computeAge('', today)).toBeNull()
    expect(computeAge('nie-je-datum', today)).toBeNull()
  })

  it('29. február', () => {
    expect(computeAge('2000-02-29', new Date(2026, 1, 28))).toBe(25)
    expect(computeAge('2000-02-29', new Date(2026, 2, 1))).toBe(26)
  })
})

describe('parseDate', () => {
  it('čistý dátum berie ako miestny kalendárny deň, nie UTC polnoc', () => {
    const d = parseDate('2025-01-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 0, 1])
  })
  it('neplatné hodnoty vráti ako null', () => {
    expect(parseDate(undefined)).toBeNull()
    expect(parseDate('xyz')).toBeNull()
  })
})

describe('formátovanie', () => {
  it('formatDate po slovensky a prázdne pre prázdnu hodnotu', () => {
    expect(formatDate('2025-01-05')).toMatch(/5\.\s?1\.\s?2025/)
    expect(formatDate(null)).toBe('')
  })

  it('formatAge skloňuje', () => {
    expect(formatAge(null)).toBe('—')
    expect(formatAge(0)).toBe('0 rokov')
    expect(formatAge(1)).toBe('1 rok')
    expect(formatAge(3)).toBe('3 roky')
    expect(formatAge(5)).toBe('5 rokov')
  })

  it('pluralize a countLabel', () => {
    expect(pluralize(1, 'profil', 'profily', 'profilov')).toBe('profil')
    expect(pluralize(4, 'profil', 'profily', 'profilov')).toBe('profily')
    expect(pluralize(0, 'profil', 'profily', 'profilov')).toBe('profilov')
    expect(countLabel(1200, 'profil', 'profily', 'profilov').replace(/\s/g, ' ')).toBe('1 200 profilov')
  })

  it('mená a formát „Meno Priezvisko [ID]"', () => {
    expect(fullName({ first_name: 'Diana', last_name: 'Vranová' })).toBe('Diana Vranová')
    expect(fullName({ first_name: '', last_name: 'Vranová' })).toBe('Vranová')
    expect(fullName(null)).toBe('')
    expect(nameWithId({ id: 7, first_name: 'Diana', last_name: 'Vranová' })).toBe('Diana Vranová [7]')
  })

  it('normalizeText odstráni diakritiku, veľkosť písmen a nadbytočné medzery', () => {
    expect(normalizeText('  Ďuriš   ŠŤASTNÁ ')).toBe('duris stastna')
    expect(normalizeText(null)).toBe('')
  })

  it('photoAgeLabel', () => {
    const now = new Date(2026, 9, 26)
    expect(photoAgeLabel(null, now)).toBe('dátum nafotenia neznámy')
    expect(photoAgeLabel('nezmysel', now)).toBe('dátum nafotenia neznámy')
    expect(photoAgeLabel('2026-10-20', now)).toBe('nafotené tento mesiac')
    expect(photoAgeLabel('2026-04-20', now)).toBe('nafotené pred 6 mes.')
    expect(photoAgeLabel('2025-09-01', now)).toBe('nafotené pred 1 rokom')
    expect(photoAgeLabel('2022-01-01', now)).toBe('nafotené pred 4 rokmi')
  })
})
