// Čistenie hodnôt z importovaných tabuliek. Tie isté pravidlá sú zrkadlené
// v supabase/migrations/040_migration.sql — pri zmene upravte oboje.
// Každá funkcia vracia { value, warning?, error? }: warning = prevzaté s výhradou,
// error = hodnotu nebolo možné prevziať (riadok sa nahlási, nikdy ticho nezmizne).

import { CLOTHING_SIZES, GENDERS, REGIONS } from '../constants/polia.js'
import { normalizeText } from './format.js'

const ok = (value, warning) => (warning ? { value, warning } : { value })
const empty = () => ({ value: null })

function clean(raw) {
  if (raw == null) return ''
  return String(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const EMAIL_IN_TEXT_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/
const PHONE_IN_TEXT_RE = /(\+?\d[\d\s/-]{7,}\d)/

// Rozdelí celé meno podľa poslednej medzery. Text v zátvorke presunie do poznámky.
export function splitName(raw) {
  let text = clean(raw)
  if (!text) return { value: null, error: 'Chýba meno.' }
  if (EMAIL_IN_TEXT_RE.test(text) || PHONE_IN_TEXT_RE.test(text)) {
    return { value: null, error: `V poli pre meno je e-mail alebo telefón: „${text}".` }
  }
  const notes = []
  text = text.replace(/[([]([^)\]]*)[)\]]/g, (_, inner) => {
    if (inner.trim()) notes.push(inner.trim())
    return ' '
  })
  text = clean(text).replace(/[,;]+$/, '')
  if (!text) return { value: null, error: 'Meno obsahuje len poznámku v zátvorke.' }
  const note = notes.length ? notes.join('; ') : null
  // Formát „Priezvisko, Meno" (bežný v Exceli): pred čiarkou je priezvisko.
  const comma = text.match(/^([^,]+),\s*([^,]+)$/)
  if (comma) {
    return {
      value: { first_name: comma[2].trim(), last_name: comma[1].trim() },
      note,
      warning: `Meno v tvare „Priezvisko, Meno" — prevzaté ako ${comma[2].trim()} ${comma[1].trim()}.`,
    }
  }
  if (text.includes(',')) return { value: null, error: `Meno „${text}" obsahuje viac čiarok — rozdeľte ho ručne.` }
  const idx = text.lastIndexOf(' ')
  const value =
    idx === -1
      ? { first_name: text, last_name: '' }
      : { first_name: text.slice(0, idx).trim(), last_name: text.slice(idx + 1).trim() }
  const result = { value, note }
  if (idx === -1) result.warning = `Jednoslovné meno „${text}" — skontrolujte.`
  else if (text.length > 45) result.warning = 'Meno je podozrivo dlhé — skontrolujte.'
  return result
}

export function normalizeGender(raw) {
  const t = normalizeText(raw)
  if (!t) return empty()
  if (['z', 'zena', 'f', 'female', 'woman', 'zenske', 'zensky', 'dievca'].includes(t)) return ok('Žena')
  if (['m', 'muz', 'male', 'man', 'muzske', 'muzsky', 'chlapec'].includes(t)) return ok('Muž')
  if (GENDERS.map(normalizeText).includes(t)) return ok(GENDERS.find((g) => normalizeText(g) === t))
  if (t.startsWith('zen')) return ok('Žena')
  if (t.startsWith('muz')) return ok('Muž')
  return ok('Iné', `Pohlavie „${clean(raw)}" uložené ako Iné.`)
}

function firstNumber(text) {
  const m = String(text).replace(',', '.').match(/\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

// „42-43" → 42, „asi 42" → 42, „42,5" → 42.5
export function parseShoeSize(raw) {
  const t = clean(raw)
  if (!t) return empty()
  const n = firstNumber(t)
  if (n == null) return { value: null, error: `Veľkosť topánok „${t}" nie je číslo.` }
  if (n < 15 || n > 55) return { value: null, error: `Veľkosť topánok ${n} je mimo rozsahu 15–55.` }
  const rounded = Math.round(n * 2) / 2
  return ok(rounded, /^\d+([.,]5)?$/.test(t) ? undefined : `Veľkosť topánok „${t}" prevedená na ${rounded}.`)
}

// „178 cm" → 178, „1,78" → 178
export function parseHeight(raw) {
  const t = clean(raw)
  if (!t) return empty()
  let n = firstNumber(t)
  if (n == null) return { value: null, error: `Výška „${t}" nie je číslo.` }
  if (n > 0 && n < 3) n = Math.round(n * 100)
  n = Math.round(n)
  if (n < 40 || n > 250) return { value: null, error: `Výška ${n} cm je mimo rozsahu 40–250.` }
  return ok(n)
}

const SIZE_ALIASES = {
  xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL', '2xl': 'XXL', xxxl: 'XXXL', '3xl': 'XXXL',
  '4xl': 'XXXL', xxxxl: 'XXXL',
}

export function normalizeClothingSize(raw) {
  const t = normalizeText(raw).replace(/\s/g, '')
  if (!t) return empty()
  if (SIZE_ALIASES[t]) return ok(SIZE_ALIASES[t])
  // „M-L", „M/L" → prvá hodnota
  const first = t.split(/[-/,]/)[0]
  if (SIZE_ALIASES[first]) return ok(SIZE_ALIASES[first], `Konfekcia „${clean(raw)}" prevedená na ${SIZE_ALIASES[first]}.`)
  if (/det|kid|child|\d/.test(t)) return ok('Iné/detské', `Konfekcia „${clean(raw)}" uložená ako Iné/detské.`)
  if (CLOTHING_SIZES.includes(clean(raw))) return ok(clean(raw))
  return ok('Iné/detské', `Neznáma konfekcia „${clean(raw)}" uložená ako Iné/detské.`)
}

const WEST = ['bratislav', 'trnav', 'nitr', 'trencin', 'trencian', 'pezinok', 'senec', 'malack', 'skalic', 'senic', 'piestan', 'galant', 'dunajsk', 'komarn', 'nove zamk', 'levice', 'topolcan', 'sala', 'hlohovec', 'myjav', 'nove mesto nad vahom', 'povazsk', 'prievidz', 'partizansk', 'bansk', 'ilav', 'puchov', 'zlate moravce', 'stupava', 'modra', 'zahor', 'zapad']
const CENTRAL = ['zilin', 'bansk', 'martin', 'ruzomber', 'liptov', 'dolny kubin', 'cadc', 'zvolen', 'lucenec', 'rimavsk', 'brezn', 'zarnovic', 'ziar', 'kremnic', 'detv', 'poltar', 'revuc', 'velky krtis', 'turcian', 'kysuc', 'orav', 'tvrdosin', 'namestovo', 'stred']
const EAST = ['kosic', 'presov', 'poprad', 'spis', 'michalov', 'humenn', 'bardejov', 'trebisov', 'roznav', 'kezmar', 'levoc', 'gelnic', 'sabinov', 'stara lubovn', 'vranov', 'svidnik', 'snin', 'sobranc', 'medzilaborc', 'stropkov', 'vychod']
const CZECH = ['cesk', 'cechy', 'cr', 'cz', 'czech', 'praha', 'brno', 'ostrav', 'olomouc', 'plzen', 'zlin', 'hodonin', 'breclav', 'uherske', 'liberec', 'pardubic', 'hradec', 'jihlav', 'opav', 'karvin', 'frydek']

// Bratislavský/Trnavský/Nitriansky/Trenčiansky → Západné; Žilinský/Banskobystrický → Stredné;
// Košický/Prešovský → Východné; české mestá → Česko.
// „Banská Štiavnica/Bystrica" je stredné — preto sa stredné kontroluje pred západným pre „bansk".
export function normalizeRegion(raw, city) {
  const t = normalizeText(raw)
  const c = normalizeText(city)
  if (!t && !c) return ok('Iné / neuvedené')
  const exact = REGIONS.find((r) => normalizeText(r) === t)
  if (exact) return ok(exact)
  for (const source of [t, c]) {
    if (!source) continue
    if (CZECH.some((k) => source === k || source.startsWith(k) || source.includes(` ${k}`))) return ok('Česko')
    if (EAST.some((k) => source.includes(k))) return ok('Východné Slovensko')
    if (source.includes('bansk') || CENTRAL.some((k) => source.includes(k))) return ok('Stredné Slovensko')
    if (WEST.some((k) => source.includes(k))) return ok('Západné Slovensko')
  }
  return ok('Iné / neuvedené', t ? `Kraj „${clean(raw)}" sa nepodarilo priradiť.` : undefined)
}

function localIso(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${String(y).padStart(4, '0')}-${m}-${d}`
}

function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

// Vracia { value: 'YYYY-MM-DD', approx: bool }
export function parseBirthDate(raw, today = new Date()) {
  // Bunka z XLSX (cellDates) je Date o miestnej polnoci — toISOString (UTC) by
  // na Slovensku vrátil predchádzajúci deň.
  const isDate = raw instanceof Date
  if (isDate && Number.isNaN(raw.getTime())) return { value: null, approx: false, error: 'Neplatný dátum narodenia.' }
  const t = isDate ? localIso(raw) : clean(raw)
  if (!t) return { value: null, approx: false }
  let value = null
  let m
  if (isDate) value = t
  else if ((m = t.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/))) value = isoDate(+m[3], +m[2], +m[1])
  else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) value = isoDate(+m[1], +m[2], +m[3])
  else if ((m = t.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$/))) {
    const yy = +m[3]
    const year = yy + (2000 + yy > today.getFullYear() ? 1900 : 2000)
    value = isoDate(year, +m[2], +m[1])
  } else if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Excel sériové číslo (dni od 30. 12. 1899)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000)
    value = d.toISOString().slice(0, 10)
  } else if ((m = t.match(/^(\d{1,3})\s*(r|rok|roky|rokov|years?)?\.?$/i))) {
    const age = +m[1]
    if (age > 0 && age < 110) {
      return {
        value: `${today.getFullYear() - age}-01-01`,
        approx: true,
        warning: `Uvedený len vek (${age}) — dátum narodenia je približný.`,
      }
    }
  } else if (/^(19|20)\d{2}$/.test(t)) {
    return { value: `${t}-01-01`, approx: true, warning: `Uvedený len rok narodenia — dátum je približný.` }
  }
  if (!value) return { value: null, approx: false, error: `Dátum narodenia „${t}" sa nepodarilo prečítať.` }
  const year = Number(value.slice(0, 4))
  if (year < 1900 || value > localIso(today)) {
    return { value: null, approx: false, error: `Dátum narodenia ${value} je nereálny.` }
  }
  return { value, approx: false }
}

export function normalizePhone(raw) {
  const t = clean(raw)
  if (!t) return empty()
  let digits = t.replace(/[^\d+]/g, '')
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`
  if (digits.startsWith('0') && digits.length === 10) digits = `+421${digits.slice(1)}`
  else if (/^9\d{8}$/.test(digits)) digits = `+421${digits}`
  else if (/^421\d{9}$/.test(digits) || /^420\d{9}$/.test(digits)) digits = `+${digits}`
  if (!/^\+\d{9,15}$/.test(digits)) return { value: t, warning: `Telefón „${t}" má nezvyčajný tvar.` }
  return ok(digits)
}

export function normalizeEmail(raw) {
  const t = clean(raw).toLowerCase().replace(/^mailto:/, '')
  if (!t) return empty()
  if (!EMAIL_RE.test(t)) return { value: null, error: `E-mail „${clean(raw)}" nemá platný tvar.` }
  return ok(t)
}

// Prázdna bunka = bez hodnoty (null), nie „nie" — inak by aktualizácia existujúceho
// profilu prepísala jeho údaje. Predvolené „nie" sa doplní až pri zakladaní profilu.
export function parseBool(raw) {
  const t = normalizeText(raw)
  if (!t) return empty()
  if (['ano', 'a', 'x', '1', 'true', 'yes', 'y', 'ok', '✓', 'v'].includes(t)) return ok(true)
  if (['nie', 'n', '0', 'false', 'no', '-'].includes(t)) return ok(false)
  return { value: null, warning: `Hodnotu „${clean(raw)}" nevieme určiť ako áno/nie — pole vynechané.` }
}

// Súhlas so spracovaním: dátum, alebo „áno" → dátum importu (s upozornením).
export function parseConsent(raw, today = new Date()) {
  if (raw instanceof Date) return parseBirthDate(raw, today)
  const t = clean(raw)
  if (!t) return empty()
  const b = parseBool(t)
  if (b.value === true) {
    return { value: localIso(today), warning: `Súhlas uvedený ako „${t}" — uložený dátum importu.` }
  }
  if (b.value === false) return { value: null, warning: `Súhlas uvedený ako „${t}" — dátum súhlasu nevyplnený.` }
  const d = parseBirthDate(t, today)
  if (d.error || d.approx) return { value: null, error: `Súhlas „${t}" nie je dátum ani áno/nie.` }
  return { value: d.value }
}

export function parseList(raw) {
  const t = clean(raw)
  if (!t) return { value: [] }
  return { value: [...new Set(t.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean))] }
}

export function parseInteger(raw) {
  const t = clean(raw)
  if (!t) return empty()
  const n = Number(t.replace(/\s/g, ''))
  if (!Number.isInteger(n)) return { value: null, error: `„${t}" nie je celé číslo.` }
  return ok(n)
}

export function parseText(raw) {
  const t = clean(raw)
  return { value: t || null }
}
