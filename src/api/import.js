// Import novej registračnej vlny z CSV/XLSX (UC-12).
// Postup: parseImportFile → autoMapColumns → loadMatchIndex + buildPreview → executeImport.
// Nič sa nezapíše bez predchádzajúceho náhľadu a rozhodnutia o duplicitách.

import { IS_DEMO, supabase, unwrap, fetchAllPages, AppError, toAppError } from './backend.js'
import { TABLES, PEOPLE, PERSON_REGISTRATIONS, REGIONS } from '../constants/polia.js'
import { getDb, requireAdmin, audit, commit, nextId, nowIso, clone } from './local/db.js'
import { normalizeText } from '../lib/format.js'
import {
  splitName, normalizeGender, parseShoeSize, parseHeight, normalizeClothingSize, normalizeRegion,
  parseBirthDate, normalizePhone, normalizeEmail, parseBool, parseList, parseInteger, parseText, parseConsent,
} from '../lib/normalize.js'

export const SKIP = '__skip'
export const EXTRA = '__extra'

// Cieľové polia importu. synonyms sa porovnávajú bez diakritiky, medzier a podčiarkovníkov.
export const IMPORT_FIELDS = [
  { key: PEOPLE.LEGACY_ID, label: 'Pôvodné číslo (ID)', synonyms: ['id', 'legacyid', 'cislo', 'poradovecislo', 'evidencnecislo', 'por', 'porc', 'c'] },
  { key: 'full_name', label: 'Meno a priezvisko (spolu)', synonyms: ['menopriezvisko', 'menoapriezvisko', 'celemeno', 'meno a priezvisko', 'name', 'fullname', 'menoapriezvisko'] },
  { key: PEOPLE.FIRST_NAME, label: 'Krstné meno', synonyms: ['meno', 'krstnemeno', 'firstname', 'krstne'] },
  { key: PEOPLE.LAST_NAME, label: 'Priezvisko', synonyms: ['priezvisko', 'lastname', 'surname'] },
  { key: PEOPLE.GENDER, label: 'Pohlavie', synonyms: ['pohlavie', 'gender', 'sex', 'muzzena'] },
  { key: PEOPLE.BIRTH_DATE, label: 'Dátum narodenia / vek', synonyms: ['datumnarodenia', 'narodenie', 'narodeny', 'narodena', 'birthdate', 'dob', 'vek', 'age', 'rokNarodenia', 'roknarodenia'] },
  { key: PEOPLE.PHONE, label: 'Telefón', synonyms: ['telefon', 'tel', 'mobil', 'telcislo', 'telefonnecislo', 'phone', 'kontakt'] },
  { key: PEOPLE.EMAIL, label: 'E-mail', synonyms: ['email', 'mail', 'emailovaadresa', 'emailadresa'] },
  { key: PEOPLE.ADDRESS, label: 'Adresa', synonyms: ['adresa', 'address', 'ulica', 'bydlisko'] },
  { key: PEOPLE.CITY, label: 'Mesto', synonyms: ['mesto', 'obec', 'city', 'mestoobec'] },
  { key: PEOPLE.REGION, label: 'Región / kraj', synonyms: ['region', 'kraj', 'okres', 'oblast'] },
  { key: PEOPLE.HEIGHT_CM, label: 'Výška (cm)', synonyms: ['vyska', 'vyskacm', 'height'] },
  { key: PEOPLE.CLOTHING_SIZE, label: 'Konfekcia', synonyms: ['konfekcia', 'konfekcnavelkost', 'velkost', 'oblecenie', 'size'] },
  { key: PEOPLE.SHOE_SIZE, label: 'Veľkosť topánok', synonyms: ['topanky', 'velkosttopanok', 'obuv', 'cislotopanok', 'shoes'] },
  { key: PEOPLE.HAIR_COLOR, label: 'Farba vlasov', synonyms: ['vlasy', 'farbavlasov', 'hair'] },
  { key: PEOPLE.EYE_COLOR, label: 'Farba očí', synonyms: ['oci', 'farbaoci', 'eyes'] },
  { key: PEOPLE.HAS_TATTOOS, label: 'Tetovanie (áno/nie)', synonyms: ['tetovanie', 'tetovania', 'tattoo', 'tattoos'] },
  { key: PEOPLE.TATTOO_NOTE, label: 'Popis tetovania', synonyms: ['popistetovania', 'tetovaniepopis', 'kdetetovanie'] },
  { key: PEOPLE.LANGUAGES, label: 'Jazyky', synonyms: ['jazyky', 'jazyk', 'languages'] },
  { key: PEOPLE.DRIVING_LICENCE, label: 'Vodičský preukaz', synonyms: ['vodicak', 'vodicskypreukaz', 'vp', 'drivinglicence'] },
  { key: PEOPLE.SKILLS, label: 'Zručnosti', synonyms: ['zrucnosti', 'schopnosti', 'skills', 'talent'] },
  { key: PEOPLE.PERIOD_LOOK, label: 'Dobový vzhľad', synonyms: ['dobovyvzhlad', 'dobovy', 'dobove'] },
  { key: PEOPLE.SPEAKING_ROLE, label: 'Textujúci', synonyms: ['textujuci', 'text', 'textova', 'hovoriaca'] },
  { key: PEOPLE.NOTES, label: 'Poznámky', synonyms: ['poznamky', 'poznamka', 'notes', 'note'] },
  { key: PEOPLE.CONSENT_AT, label: 'Súhlas so spracovaním (dátum)', synonyms: ['suhlas', 'gdpr', 'suhlasgdpr', 'consent'] },
  { key: PERSON_REGISTRATIONS.RESPONDED_AT, label: 'Kedy odpovedal (dátum)', synonyms: ['casovaznacka', 'timestamp', 'datumodpovede', 'odpovedal', 'datumregistracie'] },
]

const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]))

function headerKey(text) {
  return normalizeText(text).replace(/[\s_\-.:/()]+/g, '')
}

// ---------------------------------------------------------------------
// 1. Čítanie súboru
// ---------------------------------------------------------------------

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const counts = { ';': 0, ',': 0, '\t': 0 }
  let inQuotes = false
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}

function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '')
  if (!utf8.includes('�')) return { text: utf8, encoding: 'UTF-8' }
  // Súbor nie je v UTF-8 (typicky Excel „CSV" vo Windows-1250).
  try {
    return { text: new TextDecoder('windows-1250').decode(buffer), encoding: 'Windows-1250' }
  } catch {
    return { text: utf8, encoding: 'UTF-8 (poškodené znaky)' }
  }
}

function cellToValue(v) {
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (v == null) return ''
  return String(v).trim()
}

// Vracia { headers, rows (pole polí reťazcov), fileName, sheetName, encoding, warnings }
export async function parseImportFile(file) {
  // SheetJS je veľký — načíta sa až pri importe, nie pri štarte aplikácie.
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const isText = /\.(csv|txt|tsv)$/i.test(file.name) || file.type === 'text/csv'
  let workbook
  let encoding = null
  const warnings = []

  try {
    if (isText) {
      const decoded = decodeText(buffer)
      encoding = decoded.encoding
      if (encoding !== 'UTF-8') {
        warnings.push(`Súbor nie je v kódovaní UTF-8 (rozpoznané: ${encoding}). Skontrolujte diakritiku v náhľade.`)
      }
      workbook = XLSX.read(decoded.text, { type: 'string', raw: true, FS: detectDelimiter(decoded.text) })
    } else {
      workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
    }
  } catch (err) {
    throw new AppError('Súbor sa nepodarilo prečítať. Je to CSV alebo XLSX?', 'parse', err)
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new AppError('Súbor neobsahuje žiadny hárok.', 'parse')
  if (workbook.SheetNames.length > 1) warnings.push(`Súbor má viac hárkov, načítal sa prvý („${sheetName}").`)

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true, blankrows: false })
  const nonEmpty = matrix.filter((r) => r.some((c) => cellToValue(c) !== ''))
  if (nonEmpty.length < 2) throw new AppError('Súbor musí mať riadok hlavičky a aspoň jeden riadok dát.', 'parse')

  const width = Math.max(...nonEmpty.map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => cellToValue(nonEmpty[0][i]) || `Stĺpec ${i + 1}`)
  const rows = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => cellToValue(r[i])))
  return { headers, rows, fileName: file.name, sheetName, encoding, warnings }
}

// ---------------------------------------------------------------------
// 2. Priradenie stĺpcov
// ---------------------------------------------------------------------

// Vracia pole cieľov pre každý stĺpec: kľúč poľa, SKIP alebo EXTRA.
// Neznáme stĺpce idú do EXTRA (doplnkové odpovede vlny), nič sa nezahodí.
export function autoMapColumns(headers) {
  const used = new Set()
  const mapping = headers.map((h) => {
    const key = headerKey(h)
    if (!key) return SKIP
    const field =
      IMPORT_FIELDS.find((f) => f.synonyms.some((s) => headerKey(s) === key)) ||
      IMPORT_FIELDS.find((f) => headerKey(f.label) === key)
    if (field && !used.has(field.key)) {
      used.add(field.key)
      return field.key
    }
    // Doplnkové odpovede vidia všetci prihlásení vrátane prizeraných — kontakty
    // a citlivé údaje tam nesmú skončiť omylom.
    return looksSensitive(h) ? SKIP : EXTRA
  })
  // „meno" samotné je krstné meno len vtedy, ak existuje aj priezvisko; inak ide o celé meno.
  const firstIdx = mapping.indexOf(PEOPLE.FIRST_NAME)
  if (firstIdx !== -1 && !mapping.includes(PEOPLE.LAST_NAME) && !mapping.includes('full_name')) {
    mapping[firstIdx] = 'full_name'
  }
  return mapping
}

const SENSITIVE_RE = /(tel|mobil|phone|mail|adres|ulica|psc|iban|ucet|rodne|rc$|op$|obciansk|pas|heslo|password)/

export function looksSensitive(header) {
  return SENSITIVE_RE.test(headerKey(header))
}

export function validateMapping(mapping) {
  const problems = []
  const counts = new Map()
  for (const m of mapping) if (m !== SKIP && m !== EXTRA) counts.set(m, (counts.get(m) || 0) + 1)
  for (const [key, n] of counts) {
    if (n > 1) problems.push(`Pole „${FIELD_BY_KEY.get(key)?.label}" je priradené ${n} stĺpcom.`)
  }
  const hasName = counts.has('full_name') || counts.has(PEOPLE.FIRST_NAME) || counts.has(PEOPLE.LAST_NAME)
  if (!hasName) problems.push('Chýba stĺpec s menom.')
  if (counts.has('full_name') && (counts.has(PEOPLE.FIRST_NAME) || counts.has(PEOPLE.LAST_NAME))) {
    problems.push('Priraďte buď „Meno a priezvisko (spolu)", alebo oddelené meno a priezvisko — nie oboje.')
  }
  return problems
}

// ---------------------------------------------------------------------
// 3. Náhľad
// ---------------------------------------------------------------------

// Index existujúcich profilov na hľadanie zhody. Obsahuje kontakty — len pre správcu.
export async function loadMatchIndex() {
  const cols = [PEOPLE.ID, PEOPLE.LEGACY_ID, PEOPLE.FIRST_NAME, PEOPLE.LAST_NAME, PEOPLE.BIRTH_DATE, PEOPLE.PHONE, PEOPLE.EMAIL]
  let people
  if (IS_DEMO) {
    requireAdmin()
    people = getDb().people.map((p) => Object.fromEntries(cols.map((c) => [c, p[c] ?? null])))
  } else {
    people = await fetchAllPages(() => supabase.from(TABLES.PEOPLE).select(cols.join(',')).order(PEOPLE.ID))
  }
  const byLegacy = new Map()
  const byNameBirth = new Map()
  const byPhone = new Map()
  const byEmail = new Map()
  const push = (map, key, p) => {
    if (!key) return
    const list = map.get(key) || []
    list.push(p)
    map.set(key, list)
  }
  for (const p of people) {
    if (p.legacy_id != null) byLegacy.set(Number(p.legacy_id), p)
    if (p.birth_date) push(byNameBirth, `${normalizeText(`${p.first_name} ${p.last_name}`)}|${p.birth_date}`, p)
    const phone = normalizePhone(p.phone).value
    if (phone) push(byPhone, phone.replace(/\D/g, '').slice(-9), p)
    if (p.email) push(byEmail, p.email.toLowerCase(), p)
  }
  return { byLegacy, byNameBirth, byPhone, byEmail, count: people.length }
}

const PARSERS = {
  [PEOPLE.LEGACY_ID]: parseInteger,
  [PEOPLE.GENDER]: normalizeGender,
  [PEOPLE.PHONE]: normalizePhone,
  [PEOPLE.EMAIL]: normalizeEmail,
  [PEOPLE.HEIGHT_CM]: parseHeight,
  [PEOPLE.CLOTHING_SIZE]: normalizeClothingSize,
  [PEOPLE.SHOE_SIZE]: parseShoeSize,
  [PEOPLE.HAS_TATTOOS]: parseBool,
  [PEOPLE.DRIVING_LICENCE]: parseBool,
  [PEOPLE.PERIOD_LOOK]: parseBool,
  [PEOPLE.SPEAKING_ROLE]: parseBool,
  [PEOPLE.LANGUAGES]: parseList,
  [PEOPLE.SKILLS]: parseList,
  [PEOPLE.CONSENT_AT]: (v) => parseConsent(v),
  [PERSON_REGISTRATIONS.RESPONDED_AT]: (v) => parseBirthDate(v),
}

const FIELD_LABEL = (key) => FIELD_BY_KEY.get(key)?.label || key

function analyzeRow(cells, headers, mapping) {
  const person = {}
  const extra = {}
  const warnings = []
  const fieldErrors = []
  const fatal = []
  let respondedAt = null
  let regionRaw = null
  let birthRaw = null

  mapping.forEach((target, i) => {
    const raw = cells[i]
    if (target === SKIP) return
    if (target === EXTRA) {
      if (raw !== '') extra[headers[i]] = raw
      return
    }
    if (target === 'full_name') {
      const r = splitName(raw)
      if (r.error) fatal.push(r.error)
      else {
        person.first_name = r.value.first_name
        person.last_name = r.value.last_name
        if (r.note) person.__nameNote = r.note
        if (r.warning) warnings.push(r.warning)
      }
      return
    }
    if (target === PEOPLE.REGION) {
      regionRaw = raw
      return
    }
    if (target === PEOPLE.BIRTH_DATE) {
      birthRaw = raw
      return
    }
    const parser = PARSERS[target] || parseText
    const r = parser(raw)
    if (r.error) {
      if (target === PEOPLE.LEGACY_ID) fatal.push(`Pôvodné číslo: ${r.error}`)
      else fieldErrors.push(`${FIELD_LABEL(target)}: ${r.error}`)
      return
    }
    if (r.warning) warnings.push(r.warning)
    if (target === PERSON_REGISTRATIONS.RESPONDED_AT) respondedAt = r.value
    else if (r.value !== null && !(Array.isArray(r.value) && r.value.length === 0 && raw === '')) person[target] = r.value
  })

  if (mapping.includes(PEOPLE.FIRST_NAME) || mapping.includes(PEOPLE.LAST_NAME)) {
    if (!person.first_name && !person.last_name) fatal.push('Chýba meno.')
    else if (person.first_name && /@|\d{6,}/.test(`${person.first_name}${person.last_name || ''}`)) {
      fatal.push('V poli pre meno je e-mail alebo telefón.')
    }
  }

  if (birthRaw !== null) {
    const r = parseBirthDate(birthRaw)
    if (r.error) fieldErrors.push(`Dátum narodenia: ${r.error}`)
    else if (r.value) {
      person.birth_date = r.value
      person.birth_date_approx = r.approx
      if (r.warning) warnings.push(r.warning)
    }
  }

  // Kraj sa dopočíta len z vyplneného kraja alebo mesta — prázdne bunky nesmú
  // existujúcemu profilu nastaviť „Iné / neuvedené".
  if (String(regionRaw ?? '').trim() || person.city) {
    const r = normalizeRegion(regionRaw, person.city)
    person.region = r.value
    if (r.warning) warnings.push(r.warning)
  }

  if (person.__nameNote) {
    person.notes = [person.notes, person.__nameNote].filter(Boolean).join(' | ')
    warnings.push(`Poznámka zo zátvorky v mene presunutá do poznámok: „${person.__nameNote}".`)
    delete person.__nameNote
  }
  if (person.first_name === undefined) person.first_name = ''
  if (person.last_name === undefined) person.last_name = ''

  return { person, extra, warnings, fieldErrors, fatal, respondedAt }
}

export const MATCH_KIND = Object.freeze({ LEGACY: 'legacy', NAME_BIRTH: 'name_birth', PHONE: 'phone', EMAIL: 'email' })

// Silná zhoda = pôvodné číslo alebo meno + dátum narodenia. Zhoda len podľa telefónu
// či e-mailu je „možná zhoda" (rodina často zdieľa telefón) — nikdy sa neaktualizuje
// hromadne a nikdy z nej neprepíšeme meno ani dátum narodenia.
export function isStrongMatch(match) {
  return !!match && (match.kind === MATCH_KIND.LEGACY || match.kind === MATCH_KIND.NAME_BIRTH)
}

/**
 * Vracia null alebo { kind, reason, candidates: [profil], personId, ambiguous, weak }.
 * personId je vyplnené len pri jednoznačnej silnej zhode; inak vyberá človek.
 */
function findMatch(person, index) {
  const result = (kind, reason, candidates) => {
    const weak = kind === MATCH_KIND.PHONE || kind === MATCH_KIND.EMAIL
    const ambiguous = candidates.length > 1
    return {
      kind,
      reason: weak ? `možná zhoda — ${reason}` : reason,
      candidates,
      personId: !weak && !ambiguous ? candidates[0].id : null,
      ambiguous,
      weak,
    }
  }
  if (person.legacy_id != null) {
    const p = index.byLegacy.get(person.legacy_id)
    return p ? result(MATCH_KIND.LEGACY, `zhodné pôvodné číslo ${person.legacy_id}`, [p]) : null
  }
  const nameKey = normalizeText(`${person.first_name} ${person.last_name}`)
  if (person.birth_date) {
    const list = index.byNameBirth.get(`${nameKey}|${person.birth_date}`)
    if (list?.length) {
      return result(MATCH_KIND.NAME_BIRTH, list.length > 1 ? 'zhodné meno a dátum narodenia — viac profilov' : 'zhodné meno a dátum narodenia', list)
    }
  }
  if (person.phone) {
    const list = index.byPhone.get(person.phone.replace(/\D/g, '').slice(-9))
    if (list?.length) return result(MATCH_KIND.PHONE, 'zhodný len telefón', list)
  }
  if (person.email) {
    const list = index.byEmail.get(person.email)
    if (list?.length) return result(MATCH_KIND.EMAIL, 'zhodný len e-mail', list)
  }
  return null
}

/**
 * Vracia { rows, summary }.
 * row: { rowNumber, person, extra, respondedAt, warnings, errors, category: 'new'|'match'|'error', match }
 * strict=true: riadok s chybnou hodnotou poľa je chybný; false: chybné pole sa vynechá s varovaním.
 */
export function buildPreview({ headers, rows, mapping, index, strict = true }) {
  const seenLegacy = new Map()
  const seenNameBirth = new Map()
  const out = rows.map((cells, i) => {
    const rowNumber = i + 2 // +1 hlavička, +1 číslovanie od 1 ako v Exceli
    const a = analyzeRow(cells, headers, mapping)
    const errors = [...a.fatal]
    const warnings = [...a.warnings]
    if (strict) errors.push(...a.fieldErrors)
    else warnings.push(...a.fieldErrors.map((e) => `${e} — pole vynechané`))

    if (a.person.legacy_id != null) {
      if (seenLegacy.has(a.person.legacy_id)) {
        errors.push(`Pôvodné číslo ${a.person.legacy_id} je v súbore dvakrát (aj riadok ${seenLegacy.get(a.person.legacy_id)}).`)
      } else seenLegacy.set(a.person.legacy_id, rowNumber)
    }
    if (a.person.birth_date && a.person.legacy_id == null) {
      const key = `${normalizeText(`${a.person.first_name} ${a.person.last_name}`)}|${a.person.birth_date}`
      if (seenNameBirth.has(key)) warnings.push(`Rovnaké meno a dátum narodenia ako riadok ${seenNameBirth.get(key)} — možná duplicita v súbore.`)
      else seenNameBirth.set(key, rowNumber)
    }

    const match = errors.length ? null : findMatch(a.person, index)
    if (match?.ambiguous) warnings.push('Zhoda s viacerými profilmi — vyberte profil ručne alebo riadok preskočte.')
    if (match?.weak) warnings.push('Možná zhoda len podľa kontaktu (môže ísť o člena rodiny) — rozhodnite ručne.')
    const category = errors.length ? 'error' : match ? 'match' : 'new'
    return { rowNumber, person: a.person, extra: a.extra, respondedAt: a.respondedAt, warnings, errors, category, match }
  })
  const summary = {
    total: out.length,
    new: out.filter((r) => r.category === 'new').length,
    match: out.filter((r) => r.category === 'match').length,
    error: out.filter((r) => r.category === 'error').length,
    warnings: out.filter((r) => r.warnings.length > 0).length,
  }
  return { rows: out, summary }
}

// ---------------------------------------------------------------------
// 4–5. Vykonanie
// ---------------------------------------------------------------------

export const DUPLICATE_ACTIONS = Object.freeze({ SKIP: 'skip', UPDATE: 'update', CREATE: 'create' })

const IDENTITY_FIELDS = new Set([PEOPLE.FIRST_NAME, PEOPLE.LAST_NAME, PEOPLE.BIRTH_DATE, PEOPLE.BIRTH_DATE_APPROX])

// Pri aktualizácii sa prepíšu len polia, ktoré v súbore majú hodnotu. Meno a dátum
// narodenia len pri silnej zhode (pôvodné číslo alebo meno + dátum narodenia).
export function updatePatch(person, match) {
  const strong = isStrongMatch(match)
  const patch = {}
  for (const [k, v] of Object.entries(person)) {
    if (k === PEOPLE.LEGACY_ID) continue
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    if (!strong && IDENTITY_FIELDS.has(k)) continue
    patch[k] = v
  }
  return patch
}

// Predvolené hodnoty sa dopĺňajú len pri zakladaní nového profilu.
const INSERT_DEFAULTS = Object.freeze({
  [PEOPLE.REGION]: REGIONS[REGIONS.length - 1],
  [PEOPLE.HAS_TATTOOS]: false,
  [PEOPLE.DRIVING_LICENCE]: false,
  [PEOPLE.PERIOD_LOOK]: false,
  [PEOPLE.SPEAKING_ROLE]: false,
})

export function insertValues(person) {
  const values = { ...INSERT_DEFAULTS }
  for (const [k, v] of Object.entries(person)) if (v !== null && v !== undefined) values[k] = v
  return values
}

/**
 * plan: [{ row, action: 'create'|'update'|'skip', personId? }] (len riadky bez chýb).
 *   Pri 'update' je personId cieľový profil (silná zhoda alebo ručný výber).
 * Vracia { protocol: [{ rowNumber, name, outcome, personId, reason }], warnings: [text] }.
 */
export async function executeImport({ plan, errorRows = [], registrationId, onProgress }) {
  const protocol = errorRows.map((r) => ({
    rowNumber: r.rowNumber,
    name: `${r.person.first_name} ${r.person.last_name}`.trim(),
    outcome: 'error',
    personId: null,
    reason: r.errors.join(' '),
  }))
  const total = plan.length
  let done = 0
  const report = () => onProgress?.({ done, total })

  for (const item of plan) {
    if (item.action === DUPLICATE_ACTIONS.UPDATE && item.personId == null) {
      throw new AppError(`Riadok ${item.row.rowNumber}: nie je vybraný profil na aktualizáciu.`, 'check')
    }
  }
  const warnings = []
  const run = IS_DEMO ? executeDemo : executeSupabase
  const results = await run(plan, registrationId, (n) => {
    done += n
    report()
  }, warnings)
  return { protocol: [...protocol, ...results].sort((a, b) => a.rowNumber - b.rowNumber), warnings }
}

function protocolEntry(row, outcome, personId, reason = '') {
  return { rowNumber: row.rowNumber, name: `${row.person.first_name} ${row.person.last_name}`.trim(), outcome, personId, reason }
}

async function executeDemo(plan, registrationId, progress) {
  const admin = requireAdmin()
  const d = getDb()
  const results = []
  const chunk = 200
  for (let i = 0; i < plan.length; i += chunk) {
    for (const { row, action, personId: targetId } of plan.slice(i, i + chunk)) {
      try {
        let personId
        if (action === DUPLICATE_ACTIONS.SKIP) {
          results.push(protocolEntry(row, 'skipped', row.match?.personId ?? null, row.match ? 'Zhoda — preskočené.' : 'Preskočené.'))
          continue
        }
        if (action === DUPLICATE_ACTIONS.UPDATE) {
          const existing = d.people.find((p) => p.id === targetId)
          if (!existing) throw new AppError('Profil na aktualizáciu už neexistuje.', 'not_found')
          const before = clone(existing)
          Object.assign(existing, updatePatch(row.person, row.match), { updated_at: nowIso(), updated_by: admin.id })
          audit(TABLES.PEOPLE, existing.id, 'UPDATE', before, clone(existing))
          personId = existing.id
          results.push(protocolEntry(row, 'updated', personId, row.match.reason))
        } else {
          const values = insertValues(row.person)
          // Nový profil napriek zhode podľa pôvodného čísla nemôže niesť to isté číslo.
          if (values.legacy_id != null && d.people.some((p) => p.legacy_id === values.legacy_id)) delete values.legacy_id
          const person = {
            id: nextId('people'), legacy_id: null, gender: null, birth_date: null, birth_date_approx: false,
            phone: null, email: null, address: null, city: null, region: null, height_cm: null,
            clothing_size: null, shoe_size: null, hair_color: null, eye_color: null, has_tattoos: false,
            tattoo_note: null, languages: [], driving_licence: false, skills: [], period_look: false,
            speaking_role: false, notes: null, is_active: true, anonymized_at: null,
            consent_at: null, last_contacted_at: null,
            ...values,
            created_at: nowIso(), updated_at: nowIso(), created_by: admin.id, updated_by: null,
          }
          d.people.push(person)
          audit(TABLES.PEOPLE, person.id, 'INSERT', null, clone(person))
          personId = person.id
          results.push(protocolEntry(row, 'created', personId, action === DUPLICATE_ACTIONS.CREATE && row.match ? 'Založené ako nový profil napriek zhode.' : ''))
        }
        if (registrationId) {
          const existing = d.person_registrations.find((r) => r.person_id === personId && r.registration_id === registrationId)
          if (existing) {
            existing.extra = { ...existing.extra, ...row.extra }
            if (row.respondedAt) existing.responded_at = row.respondedAt
          } else {
            d.person_registrations.push({ person_id: personId, registration_id: registrationId, responded_at: row.respondedAt, extra: row.extra })
          }
        }
      } catch (err) {
        results.push(protocolEntry(row, 'error', null, err.message))
      }
    }
    progress(Math.min(chunk, plan.length - i))
    await new Promise((r) => setTimeout(r, 0))
  }
  commit(TABLES.PEOPLE, TABLES.PERSON_REGISTRATIONS)
  return results
}

async function executeSupabase(plan, registrationId, progress, warnings) {
  const results = []
  const regLinks = []
  const skipped = plan.filter((p) => p.action === DUPLICATE_ACTIONS.SKIP)
  for (const { row } of skipped) {
    results.push(protocolEntry(row, 'skipped', row.match?.personId ?? null, row.match ? 'Zhoda — preskočené.' : 'Preskočené.'))
  }
  progress(skipped.length)

  // Nové profily po dávkach; pri chybe dávky sa skúša po jednom, aby sa našiel chybný riadok.
  const creates = plan.filter((p) => p.action === DUPLICATE_ACTIONS.CREATE)
  for (let i = 0; i < creates.length; i += 200) {
    const batch = creates.slice(i, i + 200)
    const values = batch.map(({ row }) => {
      const v = insertValues(row.person)
      if (row.match?.kind === MATCH_KIND.LEGACY) delete v.legacy_id
      return v
    })
    const { data, error } = await supabase.from(TABLES.PEOPLE).insert(values).select(PEOPLE.ID)
    if (!error && data?.length === batch.length) {
      batch.forEach(({ row }, k) => {
        results.push(protocolEntry(row, 'created', data[k].id, row.match ? 'Založené ako nový profil napriek zhode.' : ''))
        regLinks.push({ personId: data[k].id, row })
      })
    } else {
      for (let k = 0; k < batch.length; k++) {
        const { row } = batch[k]
        const res = await supabase.from(TABLES.PEOPLE).insert(values[k]).select(PEOPLE.ID)
        if (res.error) results.push(protocolEntry(row, 'error', null, toAppError(res.error).message))
        else {
          results.push(protocolEntry(row, 'created', res.data[0].id))
          regLinks.push({ personId: res.data[0].id, row })
        }
      }
    }
    progress(batch.length)
  }

  // Aktualizácie po dávkach jedným volaním (RPC bulk_update_people v 040_migration.sql);
  // každý riadok nesie len zmenené, neprázdne polia.
  const updates = plan.filter((p) => p.action === DUPLICATE_ACTIONS.UPDATE)
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200)
    const payload = batch.map(({ row, personId }) => ({ ...updatePatch(row.person, row.match), id: personId }))
    const { data, error } = await supabase.rpc('bulk_update_people', { p_rows: payload })
    const byId = new Map((data || []).map((r) => [Number(r.id), r]))
    for (const { row, personId } of batch) {
      const r = byId.get(Number(personId))
      if (error) results.push(protocolEntry(row, 'error', personId, toAppError(error).message))
      else if (!r || !r.ok) results.push(protocolEntry(row, 'error', personId, r?.error || 'Profil sa nenašiel alebo chýba oprávnenie.'))
      else {
        results.push(protocolEntry(row, 'updated', personId, row.match?.reason || 'ručne vybraný profil'))
        regLinks.push({ personId, row })
      }
    }
    progress(batch.length)
  }

  if (registrationId && regLinks.length) {
    try {
      await linkRegistrations(registrationId, regLinks)
    } catch (err) {
      // Profily sú uložené — import nehlási neúspech, len upozorní, čo treba doriešiť.
      warnings.push(`Profily sa uložili, ale priradenie k registračnej vlne zlyhalo: ${toAppError(err).message} Spustite import znova s voľbou „Preskočiť" pre zhody, priradenie sa doplní.`)
    }
  }
  return results
}

async function linkRegistrations(registrationId, regLinks) {
  // Pri existujúcom prepojení sa doplnkové odpovede zlúčia, nie prepíšu.
  const ids = regLinks.map((l) => l.personId)
  const existing = new Map()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = unwrap(
      await supabase
        .from(TABLES.PERSON_REGISTRATIONS)
        .select(`${PERSON_REGISTRATIONS.PERSON_ID},${PERSON_REGISTRATIONS.EXTRA}`)
        .eq(PERSON_REGISTRATIONS.REGISTRATION_ID, registrationId)
        .in(PERSON_REGISTRATIONS.PERSON_ID, ids.slice(i, i + 500)),
    )
    for (const r of rows) existing.set(r.person_id, r.extra || {})
  }
  const links = regLinks.map(({ personId, row }) => ({
    person_id: personId,
    registration_id: registrationId,
    responded_at: row.respondedAt,
    extra: { ...(existing.get(personId) || {}), ...row.extra },
  }))
  for (let i = 0; i < links.length; i += 500) {
    unwrap(
      await supabase
        .from(TABLES.PERSON_REGISTRATIONS)
        .upsert(links.slice(i, i + 500), { onConflict: `${PERSON_REGISTRATIONS.PERSON_ID},${PERSON_REGISTRATIONS.REGISTRATION_ID}` }),
    )
  }
}

// ---------------------------------------------------------------------
// Protokol ako CSV (Excel-friendly: UTF-8 s BOM, bodkočiarka)
// ---------------------------------------------------------------------

const OUTCOME_LABELS = { created: 'vytvorený', updated: 'aktualizovaný', skipped: 'preskočený', error: 'chyba' }

export function protocolToCsv(protocol) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['Riadok', 'Meno', 'Výsledok', 'ID profilu', 'Dôvod / poznámka'].join(';')]
  for (const p of protocol) {
    lines.push([p.rowNumber, p.name, OUTCOME_LABELS[p.outcome] || p.outcome, p.personId ?? '', p.reason].map(esc).join(';'))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export { OUTCOME_LABELS }
