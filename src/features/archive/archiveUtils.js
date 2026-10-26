import { MATCH_STATUS } from '../../constants/polia.js'

export const STATUS_TONE = {
  [MATCH_STATUS.UNMATCHED]: 'danger',
  [MATCH_STATUS.SUGGESTED]: 'warning',
  [MATCH_STATUS.CONFIRMED]: 'success',
}

// Doplnkový údaj, podľa ktorého sa dajú odlíšiť menovci.
export function personHint(person) {
  if (!person) return ''
  const parts = []
  if (person.birth_date) parts.push(`nar. ${person.birth_date.slice(0, 4)}`)
  else if (person.age != null) parts.push(`${person.age} r.`)
  if (person.city) parts.push(person.city)
  if (person.is_active === false) parts.push('neaktívny')
  return parts.join(' · ')
}

// Dátum zo súpisky: 2026-08-19, 19.8.2026, 19. 8. 2026, 19.8.26 → YYYY-MM-DD alebo null.
export function parseShootDate(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  let y
  let m
  let d
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) {
    ;[, y, m, d] = match
  } else {
    match = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2}|\d{4})$/)
    if (!match) return null
    ;[, d, m, y] = match
    if (y.length === 2) y = `20${y}`
  }
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

// Riadky vložené zo súpisky alebo z Excelu.
// Riadok = meno, alebo stĺpce oddelené tabulátorom: meno, postava, dátum, projekt, séria.
// Prázdne stĺpce preberú spoločné hodnoty.
export function parsePastedRows(text, common) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const cols = line.includes('\t') ? line.split('\t').map((c) => c.trim()) : [line.trim()]
      const [name, role, date, production, series] = cols
      const rawDate = date || common.shoot_date
      const shootDate = parseShootDate(rawDate)
      return {
        index,
        raw_name: name || '',
        role_name: role || common.role_name || '',
        shoot_date: shootDate,
        production_name: production || common.production_name || '',
        series_name: series || common.series_name || '',
        error: !name ? 'Chýba meno.' : !shootDate ? `Neplatný alebo chýbajúci dátum „${rawDate || ''}".` : null,
      }
    })
}
