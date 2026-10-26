// Spoločné formátovanie pre celú aplikáciu.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

// „2025-01-01" je kalendárny dátum, nie okamih — parsovať v miestnom čase,
// inak ho new Date() berie ako UTC polnoc a západne od Greenwichu posunie o deň.
export function parseDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const m = DATE_ONLY.exec(String(value))
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function computeAge(birthDate, today = new Date()) {
  const b = parseDate(birthDate)
  if (!b) return null
  let age = today.getFullYear() - b.getFullYear()
  const m = today.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--
  return age
}

export function fullName(person) {
  if (!person) return ''
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
}

// Formát pre našepkávanie: „Meno Priezvisko [ID]".
export function nameWithId(person) {
  return `${fullName(person)} [${person.id}]`
}

const dateFmt = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('sk-SK', {
  day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export function formatDate(value) {
  const d = parseDate(value)
  return d ? dateFmt.format(d) : ''
}

export function formatDateTime(value) {
  const d = parseDate(value)
  return d ? dateTimeFmt.format(d) : ''
}

export function formatAge(age) {
  if (age == null) return '—'
  if (age === 1) return '1 rok'
  if (age >= 2 && age <= 4) return `${age} roky`
  return `${age} rokov`
}

// Ako dávno bola fotka nafotená — dôležité pri deťoch.
export function photoAgeLabel(takenOn, now = new Date()) {
  const taken = parseDate(takenOn)
  if (!taken) return 'dátum nafotenia neznámy'
  const months = Math.floor((now.getTime() - taken.getTime()) / (30.44 * 24 * 3600 * 1000))
  if (months < 1) return 'nafotené tento mesiac'
  if (months < 12) return `nafotené pred ${months} mes.`
  const years = Math.floor(months / 12)
  return `nafotené pred ${years} ${years === 1 ? 'rokom' : 'rokmi'}`
}

// Porovnávanie bez diakritiky a veľkosti písmen (vyhľadávanie, párovanie mien).
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function pluralize(n, one, few, many) {
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}

export function countLabel(n, one, few, many) {
  return `${n.toLocaleString('sk-SK')} ${pluralize(n, one, few, many)}`
}
