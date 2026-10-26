// Stĺpce tabuľky výberu. Tie isté definície používajú aj exporty
// (XLSX, CSV), takže čo vidíte v tabuľke, to dostanete v súbore.

import { formatDate } from '../../lib/format.js'

const yesNo = (v) => (v == null ? '' : v ? 'áno' : 'nie')

// key → { label, value(row) → hodnota na zoradenie, text(row) → text, contact, required }
export const COLUMNS = {
  name: { label: 'Meno', value: (r) => `${r.person.last_name} ${r.person.first_name}`, text: (r) => r.name, required: true },
  first_name: { label: 'Krstné meno', value: (r) => r.person.first_name },
  last_name: { label: 'Priezvisko', value: (r) => r.person.last_name },
  phone: { label: 'Telefón', value: (r) => r.phone, contact: true, required: true },
  email: { label: 'E-mail', value: (r) => r.email, contact: true, required: true },
  address: { label: 'Adresa', value: (r) => r.address, contact: true, required: true },
  city: { label: 'Mesto', value: (r) => r.person.city },
  region: { label: 'Región', value: (r) => r.person.region },
  age: { label: 'Vek', value: (r) => r.person.age, numeric: true },
  birth_date: { label: 'Dátum narodenia', value: (r) => r.birth_date, text: (r) => formatDate(r.birth_date) + (r.person.birth_date_approx ? ' (približne)' : ''), required: true },
  gender: { label: 'Pohlavie', value: (r) => r.person.gender },
  height_cm: { label: 'Výška (cm)', value: (r) => r.person.height_cm, numeric: true },
  clothing_size: { label: 'Konfekcia', value: (r) => r.person.clothing_size },
  shoe_size: { label: 'Topánky', value: (r) => r.person.shoe_size, numeric: true },
  hair_color: { label: 'Vlasy', value: (r) => r.person.hair_color },
  eye_color: { label: 'Oči', value: (r) => r.person.eye_color },
  has_tattoos: { label: 'Tetovania', value: (r) => r.person.has_tattoos, text: (r) => yesNo(r.person.has_tattoos) },
  period_look: { label: 'Dobový vzhľad', value: (r) => r.person.period_look, text: (r) => yesNo(r.person.period_look) },
  speaking_role: { label: 'Textujúci', value: (r) => r.person.speaking_role, text: (r) => yesNo(r.person.speaking_role) },
  driving_licence: { label: 'Vodičský preukaz', value: (r) => r.person.driving_licence, text: (r) => yesNo(r.person.driving_licence) },
  languages: { label: 'Jazyky', value: (r) => (r.person.languages || []).join(', ') },
  skills: { label: 'Zručnosti', value: (r) => (r.person.skills || []).join(', ') },
  note: { label: 'Poznámka k výberu', value: (r) => r.note },
  person_notes: { label: 'Poznámka k osobe', value: (r) => r.person.notes },
  shoot_days: { label: 'Nakrúcacie dni', value: (r) => r.stats?.shootDays ?? 0, numeric: true, stats: true },
  records: { label: 'Počet záznamov', value: (r) => r.stats?.records ?? 0, numeric: true, stats: true },
  last_date: { label: 'Posledné účinkovanie', value: (r) => r.stats?.lastDate ?? null, text: (r) => (r.stats?.lastDate ? formatDate(r.stats.lastDate) : 'nikdy'), stats: true },
  productions: { label: 'Projekty', value: (r) => (r.stats?.productions || []).join(', '), stats: true },
  legacy_id: { label: 'Pôvodné ID', value: (r) => r.person.legacy_id, numeric: true },
  id: { label: 'ID', value: (r) => r.id, numeric: true },
}

export const TABLE_VIEWS = [
  { key: 'contacts', label: 'Kontakty', columns: ['name', 'phone', 'email', 'city'], contact: true },
  {
    key: 'casting',
    label: 'Casting',
    columns: ['name', 'age', 'gender', 'height_cm', 'clothing_size', 'shoe_size', 'hair_color', 'eye_color', 'has_tattoos', 'period_look', 'speaking_role'],
  },
  { key: 'admin', label: 'Administratíva', columns: ['name', 'birth_date', 'address', 'note'] },
  { key: 'experience', label: 'Skúsenosti', columns: ['name', 'shoot_days', 'last_date', 'productions'] },
]

// Kompletný export — všetko, čo smie daný používateľ vidieť.
export const FULL_EXPORT_COLUMNS = [
  'id', 'legacy_id', 'first_name', 'last_name', 'gender', 'birth_date', 'age', 'phone', 'email', 'address',
  'city', 'region', 'height_cm', 'clothing_size', 'shoe_size', 'hair_color', 'eye_color', 'has_tattoos',
  'period_look', 'speaking_role', 'driving_licence', 'languages', 'skills', 'person_notes', 'note',
  'shoot_days', 'last_date',
]

export const CONTACT_EXPORT_COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'city']

export function allowedColumns(keys, canSeeContacts) {
  return keys.filter((k) => COLUMNS[k] && (canSeeContacts || !COLUMNS[k].contact))
}

export function cellText(key, row) {
  const col = COLUMNS[key]
  if (!col) return ''
  if (col.text) return col.text(row) ?? ''
  const v = col.value(row)
  return v == null ? '' : String(v)
}

export function isMissing(key, row) {
  const col = COLUMNS[key]
  if (!col?.required) return false
  const v = col.value(row)
  return v == null || v === ''
}

export function compareRows(key, dir) {
  const col = COLUMNS[key]
  const mult = dir === 'desc' ? -1 : 1
  return (a, b) => {
    const va = col.value(a)
    const vb = col.value(b)
    const ea = va == null || va === ''
    const eb = vb == null || vb === ''
    if (ea && eb) return 0
    if (ea) return 1 // prázdne vždy na koniec
    if (eb) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult
    if (typeof va === 'boolean') return (Number(va) - Number(vb)) * mult
    return String(va).localeCompare(String(vb), 'sk') * mult
  }
}
