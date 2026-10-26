// Dátový prístup k profilom ľudí.
// listPeople() je zmluva pre celú aplikáciu: odľahčený zoznam všetkých
// profilov BEZ kontaktných údajov (zodpovedá pohľadu people_list).

import { IS_DEMO, supabase, fetchAllPages, unwrap, AppError, toAppError } from './backend.js'
import {
  VIEWS, PEOPLE, TABLES, PHOTOS, BUCKETS, PHOTO_LIMITS, AUDIT_LOG, APP_USERS,
  REGISTRATIONS, PERSON_REGISTRATIONS, GENDERS, REGIONS, CLOTHING_SIZES,
} from '../constants/polia.js'
import {
  getDb, requireUser, requireStaff, requireAdmin, isStaff, currentAppUser,
  audit, commit, nextId, nowIso, clone, delay,
} from './local/db.js'
import { putDemoUpload, removeDemoUpload } from './local/demoPhotos.js'
import { forgetPhotoUrl } from './photos.js'
import { computeAge } from '../lib/format.js'

export const PEOPLE_LIST_COLUMNS = [
  PEOPLE.ID, PEOPLE.LEGACY_ID, PEOPLE.FIRST_NAME, PEOPLE.LAST_NAME, PEOPLE.GENDER,
  PEOPLE.BIRTH_DATE, PEOPLE.BIRTH_DATE_APPROX, PEOPLE.AGE, PEOPLE.CITY, PEOPLE.REGION,
  PEOPLE.HEIGHT_CM, PEOPLE.CLOTHING_SIZE, PEOPLE.SHOE_SIZE, PEOPLE.HAIR_COLOR, PEOPLE.EYE_COLOR,
  PEOPLE.HAS_TATTOOS, PEOPLE.PERIOD_LOOK, PEOPLE.SPEAKING_ROLE, PEOPLE.DRIVING_LICENCE,
  PEOPLE.LANGUAGES, PEOPLE.SKILLS, PEOPLE.NOTES, PEOPLE.IS_ACTIVE, PEOPLE.LAST_CONTACTED_AT,
  PEOPLE.CREATED_AT, PEOPLE.THUMB_PATH, PEOPLE.PHOTO_PATH, PEOPLE.PHOTO_TAKEN_ON, PEOPLE.PHOTO_COUNT,
  PEOPLE.REGISTRATION_IDS,
]

export async function listPeople() {
  if (IS_DEMO) return delay(localListPeople())
  return fetchAllPages(() =>
    supabase.from(VIEWS.PEOPLE_LIST).select(PEOPLE_LIST_COLUMNS.join(',')).order(PEOPLE.ID),
  )
}

function localListPeople() {
  requireUser()
  const d = getDb()
  const photosByPerson = new Map()
  for (const ph of d.person_photos) {
    const list = photosByPerson.get(ph.person_id) || []
    list.push(ph)
    photosByPerson.set(ph.person_id, list)
  }
  const regsByPerson = new Map()
  for (const r of d.person_registrations) {
    const list = regsByPerson.get(r.person_id) || []
    list.push(r.registration_id)
    regsByPerson.set(r.person_id, list)
  }
  return d.people
    .filter((p) => !p.anonymized_at)
    .map((p) => {
      const photos = (photosByPerson.get(p.id) || []).slice().sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id - b.id,
      )
      const row = {}
      for (const col of PEOPLE_LIST_COLUMNS) row[col] = p[col] ?? null
      row.age = computeAge(p.birth_date)
      row.thumb_path = photos[0]?.thumb_path ?? null
      row.photo_path = photos[0]?.storage_path ?? null
      row.photo_taken_on = photos[0]?.taken_on ?? null
      row.photo_count = photos.length
      row.registration_ids = (regsByPerson.get(p.id) || []).sort((a, b) => a - b)
      row.languages = p.languages || []
      row.skills = p.skills || []
      return row
    })
}

// ---------------------------------------------------------------------
// Detail profilu
// ---------------------------------------------------------------------

const CONTACT_COLUMNS = [PEOPLE.PHONE, PEOPLE.EMAIL, PEOPLE.ADDRESS]

// Polia, ktoré smie casting upravovať cez formulár.
export const EDITABLE_PERSON_FIELDS = Object.freeze([
  PEOPLE.FIRST_NAME, PEOPLE.LAST_NAME, PEOPLE.GENDER, PEOPLE.BIRTH_DATE, PEOPLE.BIRTH_DATE_APPROX,
  PEOPLE.PHONE, PEOPLE.EMAIL, PEOPLE.ADDRESS, PEOPLE.CITY, PEOPLE.REGION, PEOPLE.HEIGHT_CM,
  PEOPLE.CLOTHING_SIZE, PEOPLE.SHOE_SIZE, PEOPLE.HAIR_COLOR, PEOPLE.EYE_COLOR, PEOPLE.HAS_TATTOOS,
  PEOPLE.TATTOO_NOTE, PEOPLE.LANGUAGES, PEOPLE.DRIVING_LICENCE, PEOPLE.SKILLS, PEOPLE.PERIOD_LOOK,
  PEOPLE.SPEAKING_ROLE, PEOPLE.NOTES, PEOPLE.CONSENT_AT, PEOPLE.LAST_CONTACTED_AT,
])

const DETAIL_HIDDEN = new Set([...CONTACT_COLUMNS])

function sortPhotos(list) {
  return list.slice().sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id - b.id,
  )
}

/**
 * Celý profil: { person, photos, contacts | null, registrations: [{ id, name, responded_at, extra }] }
 * Kontakty dostane len casting a správca — v Supabase to vynúti RLS na tabuľke people.
 */
export async function getPersonDetail(id) {
  if (IS_DEMO) return delay(localPersonDetail(id))
  const personId = Number(id)
  const [detailRes, photosRes, contactsRes, staffRes, regsFullRes, regsPublicRes] = await Promise.all([
    supabase.from(VIEWS.PEOPLE_DETAIL).select('*').eq(PEOPLE.ID, personId).limit(1),
    supabase
      .from(TABLES.PERSON_PHOTOS)
      .select('*')
      .eq(PHOTOS.PERSON_ID, personId)
      .order(PHOTOS.IS_PRIMARY, { ascending: false })
      .order(PHOTOS.SORT_ORDER)
      .order(PHOTOS.ID),
    supabase.from(TABLES.PEOPLE).select(CONTACT_COLUMNS.join(',')).eq(PEOPLE.ID, personId).limit(1),
    supabase.rpc('is_staff'),
    // Tabuľku s doplnkovými odpoveďami (extra) číta len staff; ostatní dostanú
    // prázdny výsledok a použijú pohľad bez extra.
    supabase
      .from(TABLES.PERSON_REGISTRATIONS)
      .select(`${PERSON_REGISTRATIONS.REGISTRATION_ID},${PERSON_REGISTRATIONS.RESPONDED_AT},${PERSON_REGISTRATIONS.EXTRA},${TABLES.REGISTRATIONS}(${REGISTRATIONS.NAME})`)
      .eq(PERSON_REGISTRATIONS.PERSON_ID, personId),
    supabase
      .from(VIEWS.PERSON_REGISTRATIONS_PUBLIC)
      .select(`${PERSON_REGISTRATIONS.REGISTRATION_ID},${PERSON_REGISTRATIONS.RESPONDED_AT},registration_name`)
      .eq(PERSON_REGISTRATIONS.PERSON_ID, personId),
  ])
  const person = unwrap(detailRes)[0]
  if (!person) throw new AppError('Profil sa nenašiel.', 'not_found')
  const staff = unwrap(staffRes) === true
  // Chybu pri načítaní kontaktov nezahadzujeme — formulár by inak ukázal
  // prázdne kontakty a ich uloženie by ich vymazalo.
  const contactsError = staff && contactsRes.error ? toAppError(contactsRes.error) : null
  const contactRow = staff && !contactsRes.error ? contactsRes.data?.[0] || null : null
  if (staff && !contactsError && !contactRow) {
    // Staff profil vidí, ale riadok people nie — niečo nie je v poriadku, kontakty neupravovať.
    return {
      person,
      photos: unwrap(photosRes),
      contacts: null,
      contactsError: new AppError('Kontakty sa nepodarilo načítať.', 'not_found'),
      registrations: mapFullRegistrations(unwrap(regsFullRes)),
    }
  }
  const registrations = staff
    ? mapFullRegistrations(unwrap(regsFullRes))
    : unwrap(regsPublicRes).map((r) => ({
        id: r.registration_id,
        name: r.registration_name || '',
        responded_at: r.responded_at,
        extra: {},
      }))
  return { person, photos: unwrap(photosRes), contacts: contactRow, contactsError, registrations }
}

function mapFullRegistrations(rows) {
  return rows.map((r) => ({
    id: r.registration_id,
    name: r.registrations?.name || '',
    responded_at: r.responded_at,
    extra: r.extra || {},
  }))
}

function localPersonDetail(id) {
  const user = requireUser()
  const d = getDb()
  const raw = d.people.find((p) => p.id === Number(id))
  if (!raw) throw new AppError('Profil sa nenašiel.', 'not_found')
  const person = {}
  for (const [k, v] of Object.entries(raw)) if (!DETAIL_HIDDEN.has(k)) person[k] = clone(v)
  person.age = computeAge(raw.birth_date)
  const regNames = new Map(d.registrations.map((r) => [r.id, r.name]))
  return {
    person,
    photos: sortPhotos(d.person_photos.filter((p) => p.person_id === raw.id)).map(clone),
    contacts: isStaff(user) ? { phone: raw.phone, email: raw.email, address: raw.address } : null,
    contactsError: null,
    registrations: d.person_registrations
      .filter((r) => r.person_id === raw.id)
      .map((r) => ({
        id: r.registration_id,
        name: regNames.get(r.registration_id) || '',
        responded_at: r.responded_at,
        extra: isStaff(user) ? clone(r.extra || {}) : {},
      })),
  }
}

/**
 * Kontakty pre viac ľudí naraz (exporty, tabuľka výberu).
 * Vracia Map<personId, { phone, email, address, birth_date }>. Viewer dostane chybu.
 */
export async function getPeopleContacts(personIds) {
  const ids = [...new Set((personIds || []).map(Number))]
  if (IS_DEMO) {
    requireStaff()
    const wanted = new Set(ids)
    const map = new Map()
    for (const p of getDb().people) {
      if (wanted.has(p.id)) map.set(p.id, { phone: p.phone, email: p.email, address: p.address, birth_date: p.birth_date })
    }
    return delay(map)
  }
  const map = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const rows = unwrap(
      await supabase
        .from(TABLES.PEOPLE)
        .select([PEOPLE.ID, PEOPLE.PHONE, PEOPLE.EMAIL, PEOPLE.ADDRESS, PEOPLE.BIRTH_DATE].join(','))
        .in(PEOPLE.ID, chunk),
    )
    for (const r of rows) map.set(r.id, { phone: r.phone, email: r.email, address: r.address, birth_date: r.birth_date })
  }
  // RLS viewerovi nevráti chybu, len prázdny výsledok. Prázdny výsledok pri
  // neexistujúcich ID je však v poriadku — rozhodne až rola používateľa.
  if (ids.length > 0 && map.size === 0) {
    const staff = unwrap(await supabase.rpc('is_staff'))
    if (!staff) throw new AppError('Na kontaktné údaje nemáte oprávnenie.', 'forbidden')
  }
  return map
}

// ---------------------------------------------------------------------
// Úpravy profilu
// ---------------------------------------------------------------------

function emptyToNull(v) {
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  return v
}

// Vyčistí a overí vstup z formulára. Vyhodí AppError('validation') so slovenskou hláškou.
export function sanitizePersonPatch(patch, { requireNames = false } = {}) {
  const out = {}
  for (const key of EDITABLE_PERSON_FIELDS) {
    if (!(key in patch)) continue
    let v = emptyToNull(patch[key])
    if (key === PEOPLE.LANGUAGES || key === PEOPLE.SKILLS) {
      const list = Array.isArray(v) ? v : String(v ?? '').split(',')
      v = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))]
    }
    if ([PEOPLE.BIRTH_DATE_APPROX, PEOPLE.HAS_TATTOOS, PEOPLE.DRIVING_LICENCE, PEOPLE.PERIOD_LOOK, PEOPLE.SPEAKING_ROLE].includes(key)) {
      v = !!v
    }
    if (key === PEOPLE.HEIGHT_CM && v != null) v = Math.round(Number(v))
    if (key === PEOPLE.SHOE_SIZE && v != null) v = Number(String(v).replace(',', '.'))
    if (key === PEOPLE.EMAIL && v) v = v.toLowerCase()
    if ((key === PEOPLE.FIRST_NAME || key === PEOPLE.LAST_NAME) && v == null) v = ''
    out[key] = v
  }
  const errors = []
  if (requireNames && !out.first_name && !out.last_name) errors.push('Vyplňte meno alebo priezvisko.')
  if ('first_name' in out && 'last_name' in out && !out.first_name && !out.last_name) errors.push('Vyplňte meno alebo priezvisko.')
  if (out.gender && !GENDERS.includes(out.gender)) errors.push('Neplatné pohlavie.')
  if (out.region && !REGIONS.includes(out.region)) errors.push('Neplatný región.')
  if (out.clothing_size && !CLOTHING_SIZES.includes(out.clothing_size)) errors.push('Neplatná konfekčná veľkosť.')
  if (out.height_cm != null && (!Number.isFinite(out.height_cm) || out.height_cm < 40 || out.height_cm > 250)) errors.push('Výška musí byť medzi 40 a 250 cm.')
  if (out.shoe_size != null && (!Number.isFinite(out.shoe_size) || out.shoe_size < 15 || out.shoe_size > 55)) errors.push('Veľkosť topánok musí byť medzi 15 a 55.')
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) errors.push('E-mail nemá správny tvar.')
  if (out.birth_date && (Number.isNaN(new Date(out.birth_date).getTime()) || new Date(out.birth_date) > new Date())) errors.push('Neplatný dátum narodenia.')
  if (errors.length) throw new AppError(errors.join(' '), 'validation')
  return out
}

const PROFILE_DENIED = 'Profil sa nepodarilo uložiť — neexistuje alebo naň nemáte oprávnenie.'
const PHOTO_DENIED = 'Fotku sa nepodarilo zmeniť — neexistuje alebo naň nemáte oprávnenie.'

// Riadky, ktoré RLS nedovolí zmeniť, sa vrátia ako prázdny výsledok bez chyby.
function requireChanged(rows, message) {
  if (!rows || rows.length === 0) throw new AppError(message, 'forbidden')
  return rows
}

// Zmaže súbory z úložiska. Vracia zoznam ciest, ktoré sa zmazať nepodarilo.
export async function removeStorageFiles(paths) {
  const files = [...new Set((paths || []).filter(Boolean))]
  if (IS_DEMO) {
    files.forEach(removeDemoUpload)
    return []
  }
  const failed = []
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100)
    const { data, error } = await supabase.storage.from(BUCKETS.PERSON_PHOTOS).remove(chunk)
    // Súbor, ktorý už neexistuje, Storage len nevráti v `data` — nie je to chyba.
    if (error || !data) failed.push(...chunk)
  }
  files.filter((f) => !failed.includes(f)).forEach(forgetPhotoUrl)
  return failed
}

/**
 * Uloží LEN polia, ktoré sa zmenili oproti pôvodným hodnotám (patch). Polia,
 * ktorých sa používateľ nedotkol, sa neposielajú — súbežná úprava kolegu
 * ani nenačítané kontakty sa tak neprepíšu.
 */
export async function updatePerson(id, patch) {
  const clean = sanitizePersonPatch(patch)
  if (Object.keys(clean).length === 0) return { id: Number(id), unchanged: true }
  if (IS_DEMO) {
    const user = requireStaff()
    const p = getDb().people.find((x) => x.id === Number(id))
    if (!p) throw new AppError('Profil sa nenašiel.', 'not_found')
    const before = clone(p)
    Object.assign(p, clean, { updated_at: nowIso(), updated_by: user.id })
    audit(TABLES.PEOPLE, p.id, 'UPDATE', before, clone(p))
    commit(TABLES.PEOPLE)
    return delay({ id: p.id })
  }
  requireChanged(unwrap(await supabase.from(TABLES.PEOPLE).update(clean).eq(PEOPLE.ID, Number(id)).select(PEOPLE.ID)), PROFILE_DENIED)
  return { id: Number(id) }
}

export async function createPerson(data) {
  const clean = sanitizePersonPatch(data, { requireNames: true })
  if (IS_DEMO) {
    const user = requireStaff()
    const now = nowIso()
    const row = {
      id: nextId(TABLES.PEOPLE), legacy_id: null, first_name: '', last_name: '', gender: null, birth_date: null,
      birth_date_approx: false, phone: null, email: null, address: null, city: null, region: null, height_cm: null,
      clothing_size: null, shoe_size: null, hair_color: null, eye_color: null, has_tattoos: false, tattoo_note: null,
      languages: [], driving_licence: false, skills: [], period_look: false, speaking_role: false, notes: null,
      is_active: true, anonymized_at: null, consent_at: null, last_contacted_at: null,
      ...clean,
      created_at: now, updated_at: now, created_by: user.id, updated_by: null,
    }
    getDb().people.push(row)
    audit(TABLES.PEOPLE, row.id, 'INSERT', null, clone(row))
    commit(TABLES.PEOPLE)
    return delay({ id: row.id })
  }
  const rows = unwrap(await supabase.from(TABLES.PEOPLE).insert(clean).select(PEOPLE.ID))
  return { id: rows[0].id }
}

export async function setPersonActive(id, isActive) {
  if (IS_DEMO) {
    const user = requireStaff()
    const p = getDb().people.find((x) => x.id === Number(id))
    if (!p) throw new AppError('Profil sa nenašiel.', 'not_found')
    const before = clone(p)
    p.is_active = !!isActive
    p.updated_at = nowIso()
    p.updated_by = user.id
    audit(TABLES.PEOPLE, p.id, 'UPDATE', before, clone(p))
    commit(TABLES.PEOPLE)
    return delay()
  }
  requireChanged(
    unwrap(await supabase.from(TABLES.PEOPLE).update({ [PEOPLE.IS_ACTIVE]: !!isActive }).eq(PEOPLE.ID, Number(id)).select(PEOPLE.ID)),
    PROFILE_DENIED,
  )
}

/**
 * UC-16: anonymizácia na žiadosť (len správca). Zmiznú kontakty, adresa,
 * poznámky, dátum narodenia, fotky; zostane anonymný záznam a archív účinkovania.
 */
export async function anonymizePerson(id) {
  const personId = Number(id)
  if (IS_DEMO) {
    const user = requireAdmin()
    const d = getDb()
    const p = d.people.find((x) => x.id === personId)
    if (!p) throw new AppError('Profil sa nenašiel.', 'not_found')
    Object.assign(p, anonymizedFields(personId), { updated_at: nowIso(), updated_by: user.id })
    for (const ph of d.person_photos.filter((x) => x.person_id === personId)) {
      removeDemoUpload(ph.storage_path)
      if (ph.thumb_path) removeDemoUpload(ph.thumb_path)
      audit(TABLES.PERSON_PHOTOS, ph.id, 'DELETE', clone(ph), null)
    }
    d.person_photos = d.person_photos.filter((x) => x.person_id !== personId)
    d.favorites = d.favorites.filter((f) => f.person_id !== personId)
    d.selection_items = d.selection_items.filter((i) => i.person_id !== personId)
    d.person_registrations = d.person_registrations.filter((r) => r.person_id !== personId)
    // Rovnako ako SQL funkcia: meno v archíve sa nahradí anonymným označením.
    for (const a of d.appearances) {
      if (a.person_id === personId) {
        a.raw_name = `Anonymizovaný profil #${personId}`
        a.name_override = null
      }
    }
    for (const row of d.audit_log) {
      const touches =
        (row.table_name === TABLES.PEOPLE && row.row_id === String(personId)) ||
        ([TABLES.PERSON_PHOTOS, TABLES.APPEARANCES].includes(row.table_name) &&
          (String(row.old_data?.person_id) === String(personId) || String(row.new_data?.person_id) === String(personId))) ||
        (row.table_name === TABLES.SELECTION_ITEMS && row.row_id.endsWith(`:${personId}`))
      if (touches) {
        row.old_data = row.old_data ? { anonymized: true } : null
        row.new_data = row.new_data ? { anonymized: true } : null
      }
    }
    audit(TABLES.PEOPLE, personId, 'UPDATE', { anonymized: true }, { anonymized: true })
    commit(TABLES.PEOPLE, TABLES.PERSON_PHOTOS, TABLES.FAVORITES, TABLES.SELECTION_ITEMS, TABLES.APPEARANCES, TABLES.PERSON_REGISTRATIONS)
    return delay({ failedFiles: [] })
  }
  // RPC zmaže riadky fotiek a vráti cesty, súbory potom odstránime z úložiska.
  // Funkcia v 001_schema.sql vracia tabuľku riadkov { storage_path }.
  const rows = unwrap(await supabase.rpc('anonymize_person', { p_person_id: personId })) || []
  const files = rows.map((r) => (typeof r === 'string' ? r : r.storage_path)).filter(Boolean)
  // Profil je už anonymizovaný; súbory, ktoré sa nepodarilo zmazať, vrátime na opakovanie.
  return { failedFiles: await removeStorageFiles(files) }
}

function anonymizedFields(personId) {
  return {
    first_name: 'Anonymizovaný', last_name: `profil #${personId}`, gender: null, birth_date: null,
    birth_date_approx: false, phone: null, email: null, address: null, city: null, region: null,
    height_cm: null, clothing_size: null, shoe_size: null, hair_color: null, eye_color: null,
    has_tattoos: false, tattoo_note: null, languages: [], skills: [], driving_licence: false,
    period_look: false, speaking_role: false, notes: null, is_active: false, consent_at: null,
    last_contacted_at: null, anonymized_at: nowIso(),
  }
}

// ---------------------------------------------------------------------
// História zmien (len casting a správca)
// ---------------------------------------------------------------------

export async function getPersonHistory(id) {
  const personId = String(Number(id))
  if (IS_DEMO) {
    requireStaff()
    const d = getDb()
    const names = new Map(d.app_users.map((u) => [u.id, u.full_name || u.email]))
    const rows = d.audit_log
      .filter(
        (a) =>
          (a.table_name === TABLES.PEOPLE && a.row_id === personId) ||
          (a.table_name === TABLES.PERSON_PHOTOS &&
            (String(a.new_data?.person_id) === personId || String(a.old_data?.person_id) === personId)),
      )
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
      .slice(0, 100)
      .map((a) => ({ ...clone(a), changed_by_name: names.get(a.changed_by) || '' }))
    return delay(rows)
  }
  const cols = [AUDIT_LOG.ID, AUDIT_LOG.TABLE_NAME, AUDIT_LOG.ROW_ID, AUDIT_LOG.ACTION, AUDIT_LOG.OLD_DATA, AUDIT_LOG.NEW_DATA, AUDIT_LOG.CHANGED_BY, AUDIT_LOG.CHANGED_AT].join(',')
  const rows = unwrap(
    await supabase
      .from(TABLES.AUDIT_LOG)
      .select(cols)
      .or(
        `and(table_name.eq.${TABLES.PEOPLE},row_id.eq.${personId}),` +
          `and(table_name.eq.${TABLES.PERSON_PHOTOS},new_data->>person_id.eq.${personId}),` +
          `and(table_name.eq.${TABLES.PERSON_PHOTOS},old_data->>person_id.eq.${personId})`,
      )
      .order(AUDIT_LOG.CHANGED_AT, { ascending: false })
      .limit(100),
  )
  const userIds = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))]
  let names = new Map()
  if (userIds.length) {
    const users = unwrap(await supabase.from(TABLES.APP_USERS).select(`${APP_USERS.ID},${APP_USERS.FULL_NAME},${APP_USERS.EMAIL}`).in(APP_USERS.ID, userIds))
    names = new Map(users.map((u) => [u.id, u.full_name || u.email]))
  }
  return rows.map((r) => ({ ...r, changed_by_name: names.get(r.changed_by) || '' }))
}

// ---------------------------------------------------------------------
// Registračné vlny (na filter)
// ---------------------------------------------------------------------

export async function listRegistrations() {
  if (IS_DEMO) {
    requireUser()
    return delay(getDb().registrations.map(clone).sort((a, b) => String(b.period_start).localeCompare(String(a.period_start))))
  }
  return unwrap(
    await supabase
      .from(TABLES.REGISTRATIONS)
      .select([REGISTRATIONS.ID, REGISTRATIONS.NAME, REGISTRATIONS.PERIOD_START, REGISTRATIONS.PERIOD_END, REGISTRATIONS.NOTE].join(','))
      .order(REGISTRATIONS.PERIOD_START, { ascending: false, nullsFirst: false }),
  )
}

// ---------------------------------------------------------------------
// Fotografie
// ---------------------------------------------------------------------

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // niektoré prehliadače nepoznajú voľbu — skúsime cez <img>
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Zmenší obrázok na dlhšiu stranu `maxEdge`. Prekreslenie cez canvas zároveň
// odstráni všetky metadáta (EXIF vrátane polohy GPS).
async function resizeToJpeg(source, maxEdge, quality) {
  const w = source.width
  const h = source.height
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new AppError('Fotku sa nepodarilo spracovať.', 'image'))), 'image/jpeg', quality),
  )
  return { blob, width, height }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function uploadPersonPhoto(personId, file, { takenOn = null } = {}) {
  const pid = Number(personId)
  if (!file || !/^image\//.test(file.type)) throw new AppError('Vyberte súbor s obrázkom.', 'validation')
  if (IS_DEMO) requireStaff()

  let existing
  if (IS_DEMO) {
    existing = getDb().person_photos.filter((p) => p.person_id === pid)
  } else {
    existing = unwrap(await supabase.from(TABLES.PERSON_PHOTOS).select(`${PHOTOS.ID},${PHOTOS.SORT_ORDER}`).eq(PHOTOS.PERSON_ID, pid))
  }
  if (existing.length >= PHOTO_LIMITS.MAX_PER_PERSON) {
    throw new AppError(`Profil môže mať najviac ${PHOTO_LIMITS.MAX_PER_PERSON} fotografií.`, 'check')
  }

  const bitmap = await loadBitmap(file)
  const full = await resizeToJpeg(bitmap, PHOTO_LIMITS.FULL_LONG_EDGE, 0.85)
  const thumb = await resizeToJpeg(bitmap, PHOTO_LIMITS.THUMB_LONG_EDGE, 0.8)
  bitmap.close?.()

  const key = randomKey()
  const storagePath = `${pid}/${key}.jpg`
  const thumbPath = `${pid}/${key}_thumb.jpg`
  const row = {
    person_id: pid,
    storage_path: storagePath,
    thumb_path: thumbPath,
    is_primary: existing.length === 0,
    sort_order: existing.reduce((m, p) => Math.max(m, p.sort_order + 1), 0),
    taken_on: takenOn || null,
    width: full.width,
    height: full.height,
  }

  if (IS_DEMO) {
    const user = requireStaff()
    putDemoUpload(storagePath, await blobToDataUrl(full.blob))
    putDemoUpload(thumbPath, await blobToDataUrl(thumb.blob))
    const saved = { id: nextId(TABLES.PERSON_PHOTOS), ...row, created_at: nowIso(), created_by: user.id }
    getDb().person_photos.push(saved)
    audit(TABLES.PERSON_PHOTOS, saved.id, 'INSERT', null, clone(saved))
    commit(TABLES.PERSON_PHOTOS)
    return delay(clone(saved))
  }

  const bucket = supabase.storage.from(BUCKETS.PERSON_PHOTOS)
  const up1 = await bucket.upload(storagePath, full.blob, { contentType: 'image/jpeg', upsert: false })
  if (up1.error) throw new AppError('Fotku sa nepodarilo nahrať.', 'upload', up1.error)
  const up2 = await bucket.upload(thumbPath, thumb.blob, { contentType: 'image/jpeg', upsert: false })
  if (up2.error) {
    await bucket.remove([storagePath])
    throw new AppError('Fotku sa nepodarilo nahrať.', 'upload', up2.error)
  }
  let { data, error } = await supabase.from(TABLES.PERSON_PHOTOS).insert(row).select('*')
  // Kolega medzitým nahral prvú (hlavnú) fotku — jedinečný index hlavnej fotky
  // odmietne druhú, takže túto vložíme ako nehlavnú.
  if (error?.code === '23505' && row.is_primary) {
    ;({ data, error } = await supabase.from(TABLES.PERSON_PHOTOS).insert({ ...row, is_primary: false }).select('*'))
  }
  if (error) {
    await removeStorageFiles([storagePath, thumbPath])
    throw new AppError(error.message?.includes('najviac') ? error.message : 'Fotku sa nepodarilo uložiť.', 'upload', error)
  }
  return data[0]
}

export async function deletePersonPhoto(photoId) {
  const id = Number(photoId)
  if (IS_DEMO) {
    requireStaff()
    const d = getDb()
    const photo = d.person_photos.find((p) => p.id === id)
    if (!photo) return delay()
    d.person_photos = d.person_photos.filter((p) => p.id !== id)
    removeDemoUpload(photo.storage_path)
    if (photo.thumb_path) removeDemoUpload(photo.thumb_path)
    audit(TABLES.PERSON_PHOTOS, id, 'DELETE', clone(photo), null)
    if (photo.is_primary) {
      const next = sortPhotos(d.person_photos.filter((p) => p.person_id === photo.person_id))[0]
      if (next) next.is_primary = true
    }
    commit(TABLES.PERSON_PHOTOS)
    return delay({ failedFiles: [] })
  }
  const rows = requireChanged(unwrap(await supabase.from(TABLES.PERSON_PHOTOS).delete().eq(PHOTOS.ID, id).select('*')), PHOTO_DENIED)
  const photo = rows[0]
  if (photo.is_primary) {
    const rest = unwrap(
      await supabase.from(TABLES.PERSON_PHOTOS).select(PHOTOS.ID).eq(PHOTOS.PERSON_ID, photo.person_id).order(PHOTOS.SORT_ORDER).order(PHOTOS.ID).limit(1),
    )
    if (rest[0]) await setPrimaryPhoto(rest[0].id)
  }
  // Riadok je zmazaný; ak súbory v úložisku zostali, vrátime ich na opakovanie.
  return { failedFiles: await removeStorageFiles([photo.storage_path, photo.thumb_path]) }
}

export async function setPrimaryPhoto(photoId) {
  const id = Number(photoId)
  if (IS_DEMO) {
    requireStaff()
    const d = getDb()
    const photo = d.person_photos.find((p) => p.id === id)
    if (!photo) throw new AppError('Fotka sa nenašla.', 'not_found')
    for (const p of d.person_photos) {
      if (p.person_id === photo.person_id) p.is_primary = p.id === id
    }
    audit(TABLES.PERSON_PHOTOS, id, 'UPDATE', null, clone(photo))
    commit(TABLES.PERSON_PHOTOS)
    return delay()
  }
  // Jedna transakcia v databáze (010_people.sql) — profil nikdy neostane bez hlavnej fotky.
  unwrap(await supabase.rpc('set_primary_photo', { p_photo_id: id }))
}

export async function updatePhoto(photoId, patch) {
  const id = Number(photoId)
  const clean = {}
  if ('taken_on' in patch) clean.taken_on = patch.taken_on || null
  if ('sort_order' in patch) clean.sort_order = Number(patch.sort_order) || 0
  if (clean.taken_on && new Date(clean.taken_on) > new Date()) {
    throw new AppError('Dátum nafotenia nemôže byť v budúcnosti.', 'validation')
  }
  if (IS_DEMO) {
    requireStaff()
    const photo = getDb().person_photos.find((p) => p.id === id)
    if (!photo) throw new AppError('Fotka sa nenašla.', 'not_found')
    const before = clone(photo)
    Object.assign(photo, clean)
    audit(TABLES.PERSON_PHOTOS, id, 'UPDATE', before, clone(photo))
    commit(TABLES.PERSON_PHOTOS)
    return delay()
  }
  requireChanged(unwrap(await supabase.from(TABLES.PERSON_PHOTOS).update(clean).eq(PHOTOS.ID, id).select(PHOTOS.ID)), PHOTO_DENIED)
}

// Pomocník pre UI: má prihlásený používateľ právo vidieť kontakty v demo režime?
export function demoCanSeeContacts() {
  return IS_DEMO && isStaff(currentAppUser())
}
