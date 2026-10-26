// Archív účinkovania: záznamy kto–kedy–akú postavu–v čom, prepájanie na
// profily, pravidlá zjednocovania názvov, filmografia a leaderboard.
//
// Pravidlá, ktoré platia v oboch režimoch:
// - raw_name a original_* sa nikdy neprepisujú,
// - prepojenie len navrhnuté (suggested) nie je potvrdené — potvrdzuje človek,
// - do filmografie, štatistík a leaderboardu idú len confirmed a nevyradené záznamy,
// - zapisuje len staff (admin, caster), číta každý aktívny používateľ.

import { IS_DEMO, supabase, unwrap, fetchAllPages, AppError, toAppError } from './backend.js'
import {
  TABLES, VIEWS, APPEARANCES as A, ROLE_ALIASES as RA, MATCH_STATUS, ALIAS_KIND,
} from '../constants/polia.js'
import {
  getDb, commit, nextId, requireUser, requireStaff, audit, nowIso, clone, delay, getSessionUserId,
} from './local/db.js'
import { normalizeName } from '../lib/nameMatch.js'

const EDITABLE_FIELDS = [A.NAME_OVERRIDE, A.SHOOT_DATE, A.ROLE_NAME, A.PRODUCTION_NAME, A.SERIES_NAME]

const KIND_COLUMN = {
  [ALIAS_KIND.ROLE]: A.ROLE_NAME,
  [ALIAS_KIND.PRODUCTION]: A.PRODUCTION_NAME,
  [ALIAS_KIND.SERIES]: A.SERIES_NAME,
}

// Stĺpce pre tabuľku archívu a filtre. Pôvodné hodnoty (original_*), časové
// pečiatky a autori sa doťahujú až pri oprave záznamu cez getAppearance().
export const APPEARANCE_LIST_COLUMNS = [
  A.ID, A.RAW_NAME, A.NAME_OVERRIDE, A.DISPLAY_NAME, A.SHOOT_DATE,
  A.ROLE_NAME, A.PRODUCTION_NAME, A.SERIES_NAME,
  A.ROLE_EFFECTIVE, A.PRODUCTION_EFFECTIVE, A.SERIES_EFFECTIVE,
  A.PERSON_ID, A.MATCH_STATUS, A.MATCH_SCORE, A.IS_EXCLUDED, A.EXCLUDED_EFFECTIVE,
]
const LIST_SELECT = APPEARANCE_LIST_COLUMNS.join(',')

function toListRow(row) {
  const out = {}
  for (const col of APPEARANCE_LIST_COLUMNS) out[col] = row[col] ?? null
  out[A.IS_EXCLUDED] = !!out[A.IS_EXCLUDED]
  out[A.EXCLUDED_EFFECTIVE] = !!out[A.EXCLUDED_EFFECTIVE]
  return out
}

// Najnovšie hore; id ako druhý kľúč, aby bolo stránkovanie stabilné.
function compareNewestFirst(a, b) {
  if (a.shoot_date !== b.shoot_date) return a.shoot_date < b.shoot_date ? 1 : -1
  return b.id - a.id
}

const STATS_COLUMNS = [A.PERSON_ID, A.SHOOT_DATE, A.PRODUCTION_EFFECTIVE].join(',')

const FILMOGRAPHY_COLUMNS = [
  A.ID, A.SHOOT_DATE, A.DISPLAY_NAME, A.ROLE_EFFECTIVE, A.PRODUCTION_EFFECTIVE, A.SERIES_EFFECTIVE,
].join(',')

const DUP_CHECK_COLUMNS = [
  A.ID, A.RAW_NAME, A.NAME_OVERRIDE, A.PERSON_ID, A.SHOOT_DATE, A.PRODUCTION_NAME, A.ROLE_NAME,
  A.SERIES_NAME, A.MATCH_STATUS, A.IS_EXCLUDED,
].join(',')

function cleanText(value) {
  const s = value == null ? '' : String(value).trim().replace(/\s+/g, ' ')
  return s === '' ? null : s
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function notFoundOrForbidden(error) {
  if (error?.code === 'PGRST116') {
    return new AppError('Záznam sa nenašiel alebo naň nemáte oprávnenie.', 'forbidden', error)
  }
  return error
}

// ---------------------------------------------------------------------
// Kľúče duplicít — rovnaká logika ako unikátny index appearances_no_duplicate
// ---------------------------------------------------------------------

// Porovnáva sa bez diakritiky a veľkosti písmen — rovnako ako unikátny index
// appearances_no_duplicate_norm (archive_norm_name) v 030_archive.sql.
function personKey(row) {
  return row.person_id != null ? `p:${row.person_id}` : `raw:${normalizeName(row.raw_name)}`
}

export function exactDuplicateKey(row) {
  return [personKey(row), row.shoot_date, normalizeName(row.production_name), normalizeName(row.role_name)].join('|')
}

// Ten istý záznam zo súpisky bez ohľadu na prepojenie (raz nepriradený, raz prepojený).
export function sameRecordKey(row) {
  return [
    normalizeName(row.raw_name),
    row.shoot_date,
    normalizeName(row.production_name),
    normalizeName(row.role_name),
  ].join('|')
}

export function sameDayKey(row) {
  return [personKey(row), row.shoot_date, normalizeName(row.production_name)].join('|')
}

// ---------------------------------------------------------------------
// Lokálne (demo) pomocné funkcie
// ---------------------------------------------------------------------

function aliasMaps(d) {
  const maps = { [ALIAS_KIND.ROLE]: new Map(), [ALIAS_KIND.PRODUCTION]: new Map(), [ALIAS_KIND.SERIES]: new Map() }
  for (const a of d.role_aliases) maps[a.kind]?.set(a.raw_value, a)
  return maps
}

function toEffective(a, maps) {
  const ra = a.role_name != null ? maps.role.get(a.role_name) : undefined
  const pa = a.production_name != null ? maps.production.get(a.production_name) : undefined
  const sa = a.series_name != null ? maps.series.get(a.series_name) : undefined
  return {
    ...a,
    display_name: a.name_override || a.raw_name,
    role_effective: ra?.canonical_value ?? a.role_name,
    production_effective: pa?.canonical_value ?? a.production_name,
    series_effective: sa?.canonical_value ?? a.series_name,
    excluded_effective: !!(a.is_excluded || ra?.is_excluded || pa?.is_excluded || sa?.is_excluded),
  }
}

function localEffectiveRows() {
  const d = getDb()
  const maps = aliasMaps(d)
  return d.appearances.map((a) => toEffective(a, maps))
}

function localAssertUnique(d, row, ignoreId) {
  if (row.is_excluded) return
  const key = exactDuplicateKey(row)
  const clash = d.appearances.find((x) => x.id !== ignoreId && !x.is_excluded && exactDuplicateKey(x) === key)
  if (clash) {
    throw new AppError(
      'Takýto záznam už existuje (rovnaká osoba, dátum, projekt a postava).',
      'duplicate',
    )
  }
}

function localValidate(row) {
  if (!row.raw_name) throw new AppError('Chýba meno zo súpisky.', 'check')
  if (!row.shoot_date) throw new AppError('Chýba dátum nakrúcania.', 'check')
  if (!Object.values(MATCH_STATUS).includes(row.match_status)) throw new AppError('Neplatný stav prepojenia.', 'check')
  if (row.match_status !== MATCH_STATUS.UNMATCHED && row.person_id == null) {
    throw new AppError('Navrhnutý alebo potvrdený záznam musí mať priradený profil.', 'check')
  }
}

function localUpdate(id, patch) {
  requireStaff()
  const d = getDb()
  const idx = d.appearances.findIndex((a) => a.id === id)
  if (idx < 0) throw new AppError('Záznam sa nenašiel.', 'not_found')
  const old = d.appearances[idx]
  const next = { ...old, ...patch, updated_at: nowIso(), updated_by: getSessionUserId() }
  // Napodobenie triggera appearances_protect_original.
  next.raw_name = old.raw_name
  next.original_shoot_date = old.original_shoot_date
  next.original_role_name = old.original_role_name
  next.original_production_name = old.original_production_name
  next.original_series_name = old.original_series_name
  if (next.match_status === MATCH_STATUS.UNMATCHED) {
    next.person_id = null
    next.match_score = null
  }
  localValidate(next)
  localAssertUnique(d, next, id)
  d.appearances[idx] = next
  audit(TABLES.APPEARANCES, id, 'UPDATE', clone(old), clone(next))
  commit(TABLES.APPEARANCES)
  return toListRow(toEffective(next, aliasMaps(d)))
}

async function remoteUpdate(id, patch) {
  const { data, error } = await supabase.from(TABLES.APPEARANCES).update(patch).eq(A.ID, id).select(A.ID)
  if (error) throw toAppError(error)
  if (!data?.length) throw new AppError('Záznam sa nenašiel alebo naň nemáte oprávnenie.', 'forbidden')
  const row = unwrap(await supabase.from(VIEWS.APPEARANCES_EFFECTIVE).select(LIST_SELECT).eq(A.ID, id).single())
  return toListRow(row)
}

// Oba režimy vracajú rovnaký tvar ako riadok z listAppearances().
async function update(id, patch) {
  if (IS_DEMO) return delay(localUpdate(id, patch))
  return remoteUpdate(id, patch)
}

const LINK_DUPLICATE_MESSAGE =
  'Tento človek už má v ten deň v tomto projekte rovnakú postavu — záznam je duplicitný, zvážte jeho vyradenie.'

// Prepojenie mení kľúč unikátneho indexu (osoba namiesto mena) — kolízia znamená duplicitu.
async function updateLink(id, patch) {
  try {
    return await update(id, patch)
  } catch (err) {
    if (err?.code === 'duplicate' || err?.cause?.code === '23505') throw new AppError(LINK_DUPLICATE_MESSAGE, 'duplicate', err)
    throw err
  }
}

// ---------------------------------------------------------------------
// Čítanie
// ---------------------------------------------------------------------

// Celý archív po aplikovaní pravidiel zjednocovania; filtruje sa v prehliadači.
// Riadky majú len stĺpce APPEARANCE_LIST_COLUMNS.
export async function listAppearances() {
  if (IS_DEMO) {
    requireUser()
    return delay(localEffectiveRows().map(toListRow).sort(compareNewestFirst))
  }
  const rows = await fetchAllPages(() =>
    supabase
      .from(VIEWS.APPEARANCES_EFFECTIVE)
      .select(LIST_SELECT)
      .order(A.SHOOT_DATE, { ascending: false })
      .order(A.ID, { ascending: false }),
  )
  return rows.map(toListRow)
}

// Celý záznam vrátane pôvodných hodnôt zo súpisky (pre ručnú opravu).
export async function getAppearance(id) {
  if (IS_DEMO) {
    requireUser()
    const d = getDb()
    const row = d.appearances.find((a) => a.id === id)
    if (!row) throw new AppError('Záznam sa nenašiel.', 'not_found')
    return delay(toEffective(clone(row), aliasMaps(d)))
  }
  const { data, error } = await supabase.from(VIEWS.APPEARANCES_EFFECTIVE).select('*').eq(A.ID, id).single()
  if (error) throw toAppError(notFoundOrForbidden(error))
  return data
}

/**
 * Štatistiky účinkovania pre zoznam osôb (zmluva pre tím Výbery).
 * @returns Map<personId, { shootDays, records, lastDate, productions: string[] }>
 * Započítavajú sa len potvrdené a nevyradené záznamy.
 */
export async function getAppearanceStats(personIds) {
  const ids = [...new Set((personIds || []).filter((id) => id != null))]
  const result = new Map()
  for (const id of ids) result.set(id, { shootDays: 0, records: 0, lastDate: null, productions: [] })
  if (ids.length === 0) return result

  let rows
  if (IS_DEMO) {
    requireUser()
    const wanted = new Set(ids)
    rows = localEffectiveRows().filter(
      (a) => wanted.has(a.person_id) && a.match_status === MATCH_STATUS.CONFIRMED && !a.excluded_effective,
    )
  } else {
    rows = []
    for (const part of chunk(ids, 300)) {
      const page = await fetchAllPages(() =>
        supabase
          .from(VIEWS.APPEARANCES_EFFECTIVE)
          .select(STATS_COLUMNS)
          .in(A.PERSON_ID, part)
          .eq(A.MATCH_STATUS, MATCH_STATUS.CONFIRMED)
          .eq(A.EXCLUDED_EFFECTIVE, false)
          .order(A.ID),
      )
      rows.push(...page)
    }
  }

  const days = new Map()
  const prods = new Map()
  for (const r of rows) {
    const s = result.get(r.person_id)
    if (!s) continue
    s.records++
    if (!s.lastDate || r.shoot_date > s.lastDate) s.lastDate = r.shoot_date
    if (!days.has(r.person_id)) days.set(r.person_id, new Set())
    days.get(r.person_id).add(r.shoot_date)
    if (r.production_effective) {
      if (!prods.has(r.person_id)) prods.set(r.person_id, new Set())
      prods.get(r.person_id).add(r.production_effective)
    }
  }
  for (const [id, s] of result) {
    s.shootDays = days.get(id)?.size || 0
    s.productions = [...(prods.get(id) || [])].sort((a, b) => a.localeCompare(b, 'sk'))
  }
  return IS_DEMO ? delay(result) : result
}

// Filmografia osoby: potvrdené, nevyradené, od najnovšieho.
export async function getFilmography(personId) {
  let items
  if (IS_DEMO) {
    requireUser()
    items = localEffectiveRows()
      .filter((a) => a.person_id === personId && a.match_status === MATCH_STATUS.CONFIRMED && !a.excluded_effective)
      .sort((a, b) => (a.shoot_date < b.shoot_date ? 1 : a.shoot_date > b.shoot_date ? -1 : b.id - a.id))
  } else {
    items = await fetchAllPages(() =>
      supabase
        .from(VIEWS.APPEARANCES_EFFECTIVE)
        .select(FILMOGRAPHY_COLUMNS)
        .eq(A.PERSON_ID, personId)
        .eq(A.MATCH_STATUS, MATCH_STATUS.CONFIRMED)
        .eq(A.EXCLUDED_EFFECTIVE, false)
        .order(A.SHOOT_DATE, { ascending: false })
        .order(A.ID, { ascending: false }),
    )
  }
  const shootDays = new Set(items.map((i) => i.shoot_date)).size
  const result = { items, shootDays, records: items.length }
  return IS_DEMO ? delay(result) : result
}

/**
 * Leaderboard — agregované štatistiky osôb, ktoré majú aspoň jeden potvrdený záznam.
 * Ľudí bez účinkovania dopĺňa obrazovka zo zoznamu profilov (people_list),
 * pretože tabuľka people nie je pre rolu viewer čitateľná.
 * @returns [{ person_id, shootDays, records, firstDate, lastDate, productions: [], series: [] }]
 */
export async function getLeaderboard({ production = null, series = null } = {}) {
  if (IS_DEMO) {
    requireUser()
    const byPerson = new Map()
    for (const a of localEffectiveRows()) {
      if (a.match_status !== MATCH_STATUS.CONFIRMED || a.excluded_effective || a.person_id == null) continue
      if (production && a.production_effective !== production) continue
      if (series && a.series_effective !== series) continue
      let s = byPerson.get(a.person_id)
      if (!s) {
        s = { person_id: a.person_id, days: new Set(), records: 0, firstDate: null, lastDate: null, productions: new Set(), series: new Set() }
        byPerson.set(a.person_id, s)
      }
      s.days.add(a.shoot_date)
      s.records++
      if (!s.lastDate || a.shoot_date > s.lastDate) s.lastDate = a.shoot_date
      if (!s.firstDate || a.shoot_date < s.firstDate) s.firstDate = a.shoot_date
      if (a.production_effective) {
        s.productions.add(a.production_effective)
        s.series.add(a.series_effective ? `${a.production_effective} — ${a.series_effective}` : a.production_effective)
      }
    }
    return delay(
      [...byPerson.values()].map((s) => ({
        person_id: s.person_id,
        shootDays: s.days.size,
        records: s.records,
        firstDate: s.firstDate,
        lastDate: s.lastDate,
        productions: [...s.productions].sort((a, b) => a.localeCompare(b, 'sk')),
        series: [...s.series].sort((a, b) => a.localeCompare(b, 'sk')),
      })),
    )
  }
  const rows = unwrap(
    await supabase.rpc('archive_leaderboard', { p_production: production || null, p_series: series || null }),
  )
  return (rows || []).map((r) => ({
    person_id: r.person_id,
    shootDays: r.shoot_days,
    records: r.records,
    firstDate: r.first_date,
    lastDate: r.last_date,
    productions: r.productions || [],
    series: r.series || [],
  }))
}

// Projekty a ich série (po zjednotení názvov) — pre filtre.
// @returns [{ production, series: string[] }]
export async function getArchiveFacets() {
  let pairs
  if (IS_DEMO) {
    requireUser()
    pairs = localEffectiveRows()
      .filter((a) => !a.excluded_effective)
      .map((a) => ({ production: a.production_effective, series: a.series_effective }))
  } else {
    pairs = unwrap(await supabase.rpc('archive_facets')) || []
  }
  const map = new Map()
  for (const p of pairs) {
    if (!p.production) continue
    if (!map.has(p.production)) map.set(p.production, new Set())
    if (p.series) map.get(p.production).add(p.series)
  }
  const result = [...map.entries()]
    .map(([production, s]) => ({ production, series: [...s].sort((a, b) => a.localeCompare(b, 'sk')) }))
    .sort((a, b) => a.production.localeCompare(b.production, 'sk'))
  return IS_DEMO ? delay(result) : result
}

// ---------------------------------------------------------------------
// Zápis záznamov
// ---------------------------------------------------------------------

/**
 * Kontrola duplicít pred uložením — namiesto tichého zdvojenia sa používateľa opýtame.
 * @param rows [{ raw_name, shoot_date, production_name, role_name, person_id }]
 * @returns [{ exact: row|'batch'|null, sameRecord: row[], sameDay: row[] }] v rovnakom poradí ako rows.
 *   exact      — rovnaká osoba + dátum + projekt + postava; takýto záznam databáza neuloží.
 *   sameRecord — rovnaké meno zo súpisky + dátum + projekt + postava, ale inak prepojené
 *                (napr. raz nepriradený, raz potvrdený) — pravdepodobne ten istý záznam; opýtať sa.
 *   sameDay    — rovnaká osoba + dátum + projekt, iná postava; uložiť sa dá, ale treba sa opýtať.
 */
export async function checkDuplicates(rows) {
  const dates = [...new Set(rows.map((r) => r.shoot_date).filter(Boolean))]
  let existing
  if (IS_DEMO) {
    requireUser()
    const dateSet = new Set(dates)
    existing = getDb().appearances.filter((a) => !a.is_excluded && dateSet.has(a.shoot_date))
  } else {
    existing = []
    for (const part of chunk(dates, 100)) {
      const page = await fetchAllPages(() =>
        supabase
          .from(TABLES.APPEARANCES)
          .select(DUP_CHECK_COLUMNS)
          .in(A.SHOOT_DATE, part)
          .eq(A.IS_EXCLUDED, false)
          .order(A.ID),
      )
      existing.push(...page)
    }
  }
  const byExact = new Map()
  const bySameDay = new Map()
  const bySameRecord = new Map()
  const push = (map, key, e) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(e)
  }
  for (const e of existing) {
    byExact.set(exactDuplicateKey(e), e)
    push(bySameDay, sameDayKey(e), e)
    push(bySameRecord, sameRecordKey(e), e)
  }
  const seenInBatch = new Set()
  const result = rows.map((r) => {
    const ek = exactDuplicateKey(r)
    let exact = byExact.get(ek) || null
    if (!exact && seenInBatch.has(ek)) exact = 'batch'
    seenInBatch.add(ek)
    const sameRecord = (bySameRecord.get(sameRecordKey(r)) || []).filter((e) => exactDuplicateKey(e) !== ek)
    const sameDay = (bySameDay.get(sameDayKey(r)) || []).filter((e) => exactDuplicateKey(e) !== ek && !sameRecord.includes(e))
    return { exact, sameRecord, sameDay }
  })
  return IS_DEMO ? delay(result) : result
}

function sanitizeNewRow(r) {
  const row = {
    raw_name: cleanText(r.raw_name),
    shoot_date: r.shoot_date || null,
    role_name: cleanText(r.role_name),
    production_name: cleanText(r.production_name),
    series_name: cleanText(r.series_name),
    person_id: r.person_id ?? null,
    match_status: r.person_id == null ? MATCH_STATUS.UNMATCHED : r.match_status || MATCH_STATUS.SUGGESTED,
    match_score: r.person_id == null ? null : r.match_score ?? null,
    source: cleanText(r.source) || 'ručne',
  }
  if (!row.raw_name) throw new AppError('Každý záznam musí mať meno.', 'check')
  if (!row.shoot_date) throw new AppError(`Záznam „${row.raw_name}" nemá dátum nakrúcania.`, 'check')
  return row
}

/**
 * Uloží nové záznamy. Pred volaním použite checkDuplicates() a nechajte
 * používateľa rozhodnúť; presné duplicity databáza aj tak odmietne.
 */
export async function createAppearances(rows) {
  const clean = rows.map(sanitizeNewRow)
  if (clean.length === 0) return []
  if (IS_DEMO) {
    const user = requireStaff()
    const d = getDb()
    const maps = aliasMaps(d)
    const inserted = []
    // Najprv overíme celú dávku, aby sa uložilo všetko alebo nič (ako v databáze).
    const keys = new Set()
    for (const row of clean) {
      localValidate(row)
      localAssertUnique(d, row)
      const k = exactDuplicateKey(row)
      if (keys.has(k)) throw new AppError(`Záznam „${row.raw_name}" je v dávke dvakrát.`, 'duplicate')
      keys.add(k)
    }
    const now = nowIso()
    for (const row of clean) {
      const full = {
        id: nextId(TABLES.APPEARANCES),
        name_override: null,
        ...row,
        original_shoot_date: row.shoot_date,
        original_role_name: row.role_name,
        original_production_name: row.production_name,
        original_series_name: row.series_name,
        is_excluded: false,
        created_at: now,
        updated_at: now,
        created_by: user.id,
        updated_by: null,
      }
      d.appearances.push(full)
      audit(TABLES.APPEARANCES, full.id, 'INSERT', null, clone(full))
      inserted.push(toEffective(full, maps))
    }
    commit(TABLES.APPEARANCES)
    return delay(inserted)
  }
  const inserted = []
  for (const part of chunk(clean, 500)) {
    inserted.push(...unwrap(await supabase.from(TABLES.APPEARANCES).insert(part).select()))
  }
  return inserted
}

// Ručná oprava: meno (do name_override), dátum, postava, projekt, séria.
export async function updateAppearance(id, patch) {
  const clean = {}
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue
    clean[field] = field === A.SHOOT_DATE ? patch[field] || null : cleanText(patch[field])
  }
  if (A.SHOOT_DATE in clean && !clean[A.SHOOT_DATE]) throw new AppError('Dátum nakrúcania je povinný.', 'check')
  return update(id, clean)
}

// Vráti dátum, postavu, projekt, sériu a meno na hodnoty zo súpisky.
export async function revertAppearance(id) {
  let original
  if (IS_DEMO) {
    original = getDb().appearances.find((a) => a.id === id)
    if (!original) throw new AppError('Záznam sa nenašiel.', 'not_found')
  } else {
    original = unwrap(
      await supabase
        .from(TABLES.APPEARANCES)
        .select([A.ORIGINAL_SHOOT_DATE, A.ORIGINAL_ROLE_NAME, A.ORIGINAL_PRODUCTION_NAME, A.ORIGINAL_SERIES_NAME].join(','))
        .eq(A.ID, id)
        .single(),
    )
  }
  return update(id, {
    [A.NAME_OVERRIDE]: null,
    [A.SHOOT_DATE]: original.original_shoot_date,
    [A.ROLE_NAME]: original.original_role_name,
    [A.PRODUCTION_NAME]: original.original_production_name,
    [A.SERIES_NAME]: original.original_series_name,
  })
}

// Človek priradil záznam k profilu → potvrdené.
export async function linkAppearance(id, personId) {
  if (personId == null) throw new AppError('Vyberte profil.', 'check')
  return updateLink(id, { [A.PERSON_ID]: personId, [A.MATCH_STATUS]: MATCH_STATUS.CONFIRMED, [A.MATCH_SCORE]: null })
}

// Systémový návrh prepojenia — nikdy nie je potvrdením.
export async function suggestAppearance(id, personId, score = null) {
  if (personId == null) throw new AppError('Vyberte profil.', 'check')
  return updateLink(id, { [A.PERSON_ID]: personId, [A.MATCH_STATUS]: MATCH_STATUS.SUGGESTED, [A.MATCH_SCORE]: score })
}

// Potvrdenie existujúceho návrhu.
export async function confirmSuggestion(id) {
  return updateLink(id, { [A.MATCH_STATUS]: MATCH_STATUS.CONFIRMED })
}

// Zamietnutie návrhu alebo odpojenie potvrdeného prepojenia.
export async function unlinkAppearance(id) {
  return update(id, { [A.PERSON_ID]: null, [A.MATCH_STATUS]: MATCH_STATUS.UNMATCHED, [A.MATCH_SCORE]: null })
}

// Vyradenie záznamu (namiesto mazania) a jeho obnovenie.
export async function setExcluded(id, excluded) {
  return update(id, { [A.IS_EXCLUDED]: !!excluded })
}

// ---------------------------------------------------------------------
// Zjednocovanie názvov (postavy, projekty, série)
// ---------------------------------------------------------------------

/**
 * Všetky rôzne pôvodné hodnoty daného druhu s počtom výskytov a aktuálnym pravidlom.
 * @returns [{ raw_value, occurrences, alias: { id, canonical_value, is_excluded } | null }]
 */
export async function listNameValues(kind) {
  const column = KIND_COLUMN[kind]
  if (!column) throw new AppError('Neznámy druh názvu.', 'check')
  let counts
  let aliases
  if (IS_DEMO) {
    requireUser()
    const d = getDb()
    counts = new Map()
    for (const a of d.appearances) {
      const v = a[column]
      if (v == null) continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
    aliases = d.role_aliases.filter((a) => a.kind === kind).map(clone)
  } else {
    const rows = unwrap(await supabase.rpc('archive_name_values', { p_kind: kind })) || []
    counts = new Map(rows.map((r) => [r.raw_value, r.occurrences]))
    aliases = await fetchAllPages(() =>
      supabase.from(TABLES.ROLE_ALIASES).select('*').eq(RA.KIND, kind).order(RA.ID),
    )
  }
  const byRaw = new Map(aliases.map((a) => [a.raw_value, a]))
  const values = new Set([...counts.keys(), ...byRaw.keys()])
  const result = [...values]
    .map((raw) => ({ raw_value: raw, occurrences: counts.get(raw) || 0, alias: byRaw.get(raw) || null }))
    .sort((a, b) => b.occurrences - a.occurrences || a.raw_value.localeCompare(b.raw_value, 'sk'))
  return IS_DEMO ? delay(result) : result
}

// Vytvorí alebo zmení pravidlo pre jednu pôvodnú hodnotu.
export async function upsertAlias({ kind, raw_value, canonical_value = null, is_excluded = false }) {
  if (!KIND_COLUMN[kind]) throw new AppError('Neznámy druh názvu.', 'check')
  const canonical = cleanText(canonical_value)
  if (!canonical && !is_excluded) throw new AppError('Zadajte spoločný názov alebo hodnotu vyraďte.', 'check')
  if (raw_value == null) throw new AppError('Chýba pôvodná hodnota.', 'check')
  const row = { kind, raw_value, canonical_value: canonical, is_excluded: !!is_excluded }
  if (IS_DEMO) {
    const user = requireStaff()
    const d = getDb()
    const idx = d.role_aliases.findIndex((a) => a.kind === kind && a.raw_value === raw_value)
    let saved
    if (idx >= 0) {
      const old = d.role_aliases[idx]
      saved = { ...old, ...row }
      d.role_aliases[idx] = saved
      audit(TABLES.ROLE_ALIASES, saved.id, 'UPDATE', clone(old), clone(saved))
    } else {
      saved = { id: nextId(TABLES.ROLE_ALIASES), ...row, created_at: nowIso(), created_by: user.id }
      d.role_aliases.push(saved)
      audit(TABLES.ROLE_ALIASES, saved.id, 'INSERT', null, clone(saved))
    }
    commit(TABLES.ROLE_ALIASES)
    return delay(clone(saved))
  }
  return unwrap(
    await supabase.from(TABLES.ROLE_ALIASES).upsert(row, { onConflict: `${RA.KIND},${RA.RAW_VALUE}` }).select().single(),
  )
}

// Zruší pravidlo — hodnota sa vráti do pôvodného stavu.
export async function deleteAlias(id) {
  if (IS_DEMO) {
    requireStaff()
    const d = getDb()
    const idx = d.role_aliases.findIndex((a) => a.id === id)
    if (idx < 0) return delay(null)
    const [old] = d.role_aliases.splice(idx, 1)
    audit(TABLES.ROLE_ALIASES, id, 'DELETE', clone(old), null)
    commit(TABLES.ROLE_ALIASES)
    return delay(null)
  }
  unwrap(await supabase.from(TABLES.ROLE_ALIASES).delete().eq(RA.ID, id))
  return null
}

/**
 * Uplatní viac zmien pravidiel naraz — buď všetky, alebo žiadnu.
 * changes: [{ raw_value, rule: { canonical_value, is_excluded } | null }] (plán z src/lib/aliasPlan.js)
 * rule = null zruší pravidlo. Vracia počet uplatnených zmien.
 */
export async function applyAliasChanges(kind, changes) {
  if (!KIND_COLUMN[kind]) throw new AppError('Neznámy druh názvu.', 'check')
  const list = (changes || []).map((c) => ({
    raw_value: c.raw_value,
    rule: c.rule
      ? { canonical_value: cleanText(c.rule.canonical_value), is_excluded: !!c.rule.is_excluded }
      : null,
  }))
  for (const c of list) {
    if (c.raw_value == null) throw new AppError('Chýba pôvodná hodnota.', 'check')
    if (c.rule && c.rule.canonical_value === c.raw_value) c.rule.canonical_value = null
    if (c.rule && !c.rule.canonical_value && !c.rule.is_excluded) {
      throw new AppError('Pravidlo musí hodnotu zlúčiť alebo vyradiť.', 'check')
    }
  }
  if (list.length === 0) return 0

  if (IS_DEMO) {
    const user = requireStaff()
    const d = getDb()
    // Najprv sa pripraví nový stav a overí sa; až potom sa naraz zapíše (atomicky).
    const next = d.role_aliases.map((a) => ({ ...a }))
    const touched = new Set()
    for (const c of list) {
      touched.add(c.raw_value)
      const idx = next.findIndex((a) => a.kind === kind && a.raw_value === c.raw_value)
      if (!c.rule) {
        if (idx >= 0) next.splice(idx, 1)
      } else if (idx >= 0) {
        next[idx] = { ...next[idx], ...c.rule }
      } else {
        next.push({ id: null, kind, raw_value: c.raw_value, ...c.rule, created_at: nowIso(), created_by: user.id })
      }
    }
    const byRaw = new Map(next.filter((a) => a.kind === kind).map((a) => [a.raw_value, a]))
    for (const a of byRaw.values()) {
      const target = a.canonical_value != null ? byRaw.get(a.canonical_value) : null
      if (target?.canonical_value != null && (touched.has(a.raw_value) || touched.has(target.raw_value))) {
        throw new AppError('Zmena by vytvorila reťazec pravidiel (A→B→C). Zlúčte hodnoty priamo pod konečný názov.', 'check')
      }
    }
    const before = new Map(d.role_aliases.filter((a) => a.kind === kind).map((a) => [a.raw_value, a]))
    for (const a of next) {
      if (a.id == null) a.id = nextId(TABLES.ROLE_ALIASES)
    }
    for (const raw of touched) {
      const old = before.get(raw)
      const now = byRaw.get(raw)
      if (old && !now) audit(TABLES.ROLE_ALIASES, old.id, 'DELETE', clone(old), null)
      else if (!old && now) audit(TABLES.ROLE_ALIASES, now.id, 'INSERT', null, clone(now))
      else if (old && now) audit(TABLES.ROLE_ALIASES, now.id, 'UPDATE', clone(old), clone(now))
    }
    d.role_aliases = next
    commit(TABLES.ROLE_ALIASES)
    return delay(list.length)
  }
  return unwrap(await supabase.rpc('archive_apply_alias_changes', { p_kind: kind, p_changes: list }))
}
