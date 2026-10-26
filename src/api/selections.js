// Uložené výbery (castingové zostavy) a ich položky.
// Zmeny sa zapisujú PO POLOŽKÁCH — nikdy sa neprepisuje celý výber, aby
// si dvaja ľudia pracujúci naraz nezmazali prácu.

import { IS_DEMO, supabase, unwrap, fetchAllPages, AppError } from './backend.js'
import { TABLES, SELECTIONS, SELECTION_ITEMS, APP_USERS, ROLES } from '../constants/polia.js'
import {
  getDb, commit, subscribe, nextId, nowIso, clone, delay,
  requireUser, requireStaff, audit,
} from './local/db.js'

const T_SEL = TABLES.SELECTIONS
const T_ITEMS = TABLES.SELECTION_ITEMS

function cleanMeta(meta = {}) {
  const out = {}
  if (meta.name !== undefined) {
    const name = String(meta.name || '').trim()
    if (!name) throw new AppError('Výber musí mať názov.', 'validation')
    out[SELECTIONS.NAME] = name
  }
  if (meta.project_name !== undefined) out[SELECTIONS.PROJECT_NAME] = String(meta.project_name || '').trim() || null
  if (meta.subtitle !== undefined) out[SELECTIONS.SUBTITLE] = String(meta.subtitle || '').trim() || null
  return out
}

function normalizeItems(items = []) {
  const seen = new Set()
  const out = []
  for (const it of items) {
    const personId = Number(it.personId ?? it.person_id)
    if (!Number.isFinite(personId) || seen.has(personId)) continue
    seen.add(personId)
    out.push({ personId, note: (it.note || '').trim() || null })
  }
  return out
}

// Vypočíta rozdiel košíka voči snapshotu načítanému zo servera.
export function diffSelection(snapshot = [], items = []) {
  const before = new Map(normalizeItems(snapshot).map((i) => [i.personId, i.note || '']))
  const after = normalizeItems(items)
  const afterIds = new Set(after.map((i) => i.personId))
  const added = after.filter((i) => !before.has(i.personId))
  const removed = [...before.keys()].filter((id) => !afterIds.has(id))
  const notes = after.filter((i) => before.has(i.personId) && (before.get(i.personId) || '') !== (i.note || ''))
  return { added, removed, notes, hasChanges: added.length + removed.length + notes.length > 0 }
}

// ---------------------------------------------------------------------
// Čítanie
// ---------------------------------------------------------------------

// [{ id, name, project_name, subtitle, created_at, updated_at, created_by,
//    updated_by, item_count, author_name, updated_by_name }]
export async function listSelections() {
  if (IS_DEMO) return delay(localList())
  const rows = unwrap(
    await supabase
      .from(T_SEL)
      .select(`*, ${T_ITEMS}(count)`)
      .eq(SELECTIONS.IS_ARCHIVED, false)
      .order(SELECTIONS.UPDATED_AT, { ascending: false }),
  )
  const names = await userNames()
  return rows.map((r) => {
    const { [T_ITEMS]: agg, ...rest } = r
    return {
      ...rest,
      item_count: agg?.[0]?.count ?? 0,
      author_name: names.get(r.created_by) || 'neznámy',
      updated_by_name: names.get(r.updated_by) || '',
    }
  })
}

// { selection, items: [{ person_id, note, sort_order, added_at, added_by }] }
export async function getSelection(id) {
  const selectionId = Number(id)
  if (IS_DEMO) return delay(localGet(selectionId))
  const selection = unwrap(await supabase.from(T_SEL).select('*').eq(SELECTIONS.ID, selectionId).maybeSingle())
  if (!selection) throw new AppError('Výber sa nenašiel. Možno ho niekto zmazal.', 'not_found')
  const items = await fetchAllPages(() =>
    supabase
      .from(T_ITEMS)
      .select([SELECTION_ITEMS.PERSON_ID, SELECTION_ITEMS.NOTE, SELECTION_ITEMS.SORT_ORDER, SELECTION_ITEMS.ADDED_AT, SELECTION_ITEMS.ADDED_BY].join(','))
      .eq(SELECTION_ITEMS.SELECTION_ID, selectionId)
      .order(SELECTION_ITEMS.SORT_ORDER)
      .order(SELECTION_ITEMS.ADDED_AT)
      .order(SELECTION_ITEMS.PERSON_ID),
  )
  const names = await userNames()
  return {
    selection: { ...selection, author_name: names.get(selection.created_by) || 'neznámy', updated_by_name: names.get(selection.updated_by) || '' },
    items,
  }
}

async function userNames() {
  const { data } = await supabase.from(TABLES.APP_USERS).select([APP_USERS.ID, APP_USERS.FULL_NAME, APP_USERS.EMAIL].join(','))
  return new Map((data || []).map((u) => [u.id, u.full_name || u.email]))
}

// ---------------------------------------------------------------------
// Zápis
// ---------------------------------------------------------------------

export async function createSelection(meta, items = []) {
  const clean = cleanMeta({ name: meta?.name, project_name: meta?.project_name, subtitle: meta?.subtitle })
  const list = normalizeItems(items)
  if (IS_DEMO) return delay(localCreate(clean, list))
  // Hlavička aj položky v jednej transakcii (supabase/migrations/020_selections.sql),
  // aby po chybe nezostal neúplný výber.
  return unwrap(
    await supabase.rpc('create_selection_with_items', {
      p_name: clean[SELECTIONS.NAME],
      p_project_name: clean[SELECTIONS.PROJECT_NAME] ?? null,
      p_subtitle: clean[SELECTIONS.SUBTITLE] ?? null,
      p_items: list.map((it) => ({ person_id: it.personId, note: it.note })),
    }),
  )
}

export async function updateSelectionMeta(id, meta) {
  const clean = cleanMeta(meta)
  if (IS_DEMO) return delay(localUpdateMeta(Number(id), clean))
  return unwrap(await supabase.from(T_SEL).update(clean).eq(SELECTIONS.ID, Number(id)).select('*').single())
}

// changes: { added: [{personId, note}], removed: [personId], notes: [{personId, note}] }
// Vracia { selection, items, lostNotes } — lostNotes = poznámky k osobám, ktoré
// medzitým niekto z výberu odobral (poznámka sa neuložila).
export async function applySelectionChanges(id, meta, changes) {
  const selectionId = Number(id)
  const added = normalizeItems(changes?.added)
  const removed = [...new Set((changes?.removed || []).map(Number))]
  const notes = normalizeItems(changes?.notes)
  const clean = meta ? cleanMeta(meta) : {}
  if (IS_DEMO) return delay(localApply(selectionId, clean, { added, removed, notes }))

  if (Object.keys(clean).length) {
    unwrap(await supabase.from(T_SEL).update(clean).eq(SELECTIONS.ID, selectionId))
  }
  if (added.length) {
    const { data: last } = await supabase
      .from(T_ITEMS)
      .select(SELECTION_ITEMS.SORT_ORDER)
      .eq(SELECTION_ITEMS.SELECTION_ID, selectionId)
      .order(SELECTION_ITEMS.SORT_ORDER, { ascending: false })
      .limit(1)
    const base = (last?.[0]?.sort_order ?? -1) + 1
    const rows = added.map((it, idx) => ({
      [SELECTION_ITEMS.SELECTION_ID]: selectionId,
      [SELECTION_ITEMS.PERSON_ID]: it.personId,
      [SELECTION_ITEMS.NOTE]: it.note,
      [SELECTION_ITEMS.SORT_ORDER]: base + idx,
    }))
    unwrap(
      await supabase
        .from(T_ITEMS)
        .upsert(rows, { onConflict: `${SELECTION_ITEMS.SELECTION_ID},${SELECTION_ITEMS.PERSON_ID}`, ignoreDuplicates: true }),
    )
  }
  if (removed.length) {
    unwrap(
      await supabase.from(T_ITEMS).delete().eq(SELECTION_ITEMS.SELECTION_ID, selectionId).in(SELECTION_ITEMS.PERSON_ID, removed),
    )
  }
  // Poznámka osoby, ktorú medzitým niekto z výberu odobral, sa nemá kam uložiť —
  // takú osobu vrátime volajúcemu, aby ju mohol ponúknuť vrátiť.
  const lostNotes = []
  for (const it of notes) {
    const updated = unwrap(
      await supabase
        .from(T_ITEMS)
        .update({ [SELECTION_ITEMS.NOTE]: it.note })
        .eq(SELECTION_ITEMS.SELECTION_ID, selectionId)
        .eq(SELECTION_ITEMS.PERSON_ID, it.personId)
        .select(SELECTION_ITEMS.PERSON_ID),
    )
    if (!updated || updated.length === 0) lostNotes.push(it)
  }
  return { ...(await getSelection(selectionId)), lostNotes }
}

export async function setItemNote(selectionId, personId, note) {
  return applySelectionChanges(selectionId, null, { notes: [{ personId, note }] })
}

export async function deleteSelection(id) {
  const selectionId = Number(id)
  if (IS_DEMO) return delay(localDelete(selectionId))
  const { data, error } = await supabase.from(T_SEL).delete().eq(SELECTIONS.ID, selectionId).select(SELECTIONS.ID)
  if (error) throw new AppError(error.message, error.code, error)
  // RLS pri nedostatočnom oprávnení nevráti chybu, len nič nezmaže.
  if (!data || data.length === 0) throw new AppError('Výber môže zmazať len jeho autor alebo správca.', 'forbidden')
}

// ---------------------------------------------------------------------
// Odber zmien (spolupráca viacerých ľudí naraz)
// ---------------------------------------------------------------------

// selectionId == null → všetky výbery (zoznam).
export function subscribeSelections(selectionId, onChange) {
  if (IS_DEMO) {
    return subscribe((tables) => {
      if (tables.includes('*') || tables.includes(T_SEL) || tables.includes(T_ITEMS)) onChange()
    })
  }
  const name = `selections-${selectionId ?? 'all'}-${Math.random().toString(36).slice(2)}`
  const channel = supabase.channel(name)
  if (selectionId != null) {
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: T_ITEMS, filter: `${SELECTION_ITEMS.SELECTION_ID}=eq.${Number(selectionId)}` }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: T_SEL, filter: `${SELECTIONS.ID}=eq.${Number(selectionId)}` }, () => onChange())
  } else {
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: T_SEL }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: T_ITEMS }, () => onChange())
  }
  channel.subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export function subscribeSelection(id, onChange) {
  return subscribeSelections(id, onChange)
}

// ---------------------------------------------------------------------
// Demo režim
// ---------------------------------------------------------------------

function demoNames() {
  return new Map(getDb().app_users.map((u) => [u.id, u.full_name || u.email]))
}

function localList() {
  requireUser()
  const d = getDb()
  const counts = new Map()
  for (const it of d.selection_items) counts.set(it.selection_id, (counts.get(it.selection_id) || 0) + 1)
  const names = demoNames()
  return d.selections
    .filter((s) => !s.is_archived)
    .map((s) => ({
      ...clone(s),
      item_count: counts.get(s.id) || 0,
      author_name: names.get(s.created_by) || 'neznámy',
      updated_by_name: names.get(s.updated_by) || '',
    }))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

function localGet(id) {
  requireUser()
  const d = getDb()
  const selection = d.selections.find((s) => s.id === id)
  if (!selection) throw new AppError('Výber sa nenašiel. Možno ho niekto zmazal.', 'not_found')
  const names = demoNames()
  const items = d.selection_items
    .filter((i) => i.selection_id === id)
    .sort((a, b) => a.sort_order - b.sort_order || String(a.added_at).localeCompare(String(b.added_at)))
    .map((i) => ({ person_id: i.person_id, note: i.note, sort_order: i.sort_order, added_at: i.added_at, added_by: i.added_by }))
  return {
    selection: { ...clone(selection), author_name: names.get(selection.created_by) || 'neznámy', updated_by_name: names.get(selection.updated_by) || '' },
    items,
  }
}

function touch(d, selection, userId) {
  selection.updated_at = nowIso()
  selection.updated_by = userId
}

function localCreate(meta, list) {
  const user = requireStaff()
  const d = getDb()
  const now = nowIso()
  const selection = {
    id: nextId(T_SEL),
    name: meta.name,
    project_name: meta.project_name ?? null,
    subtitle: meta.subtitle ?? null,
    is_archived: false,
    created_at: now,
    updated_at: now,
    created_by: user.id,
    updated_by: user.id,
  }
  const before = { selections: d.selections.length, items: d.selection_items.length, audit: d.audit_log.length }
  try {
    d.selections.push(selection)
    audit(T_SEL, selection.id, 'INSERT', null, selection)
    const peopleIds = new Set(d.people.map((p) => p.id))
    list.forEach((it, idx) => {
      if (!peopleIds.has(it.personId)) return
      const row = { selection_id: selection.id, person_id: it.personId, note: it.note, sort_order: idx, added_at: now, added_by: user.id, updated_at: now }
      d.selection_items.push(row)
      audit(T_ITEMS, `${selection.id}:${it.personId}`, 'INSERT', null, row)
    })
  } catch (err) {
    // Kompenzácia ako transakcia v databáze: neúplný výber neponecháme.
    d.selections.length = before.selections
    d.selection_items.length = before.items
    d.audit_log.length = before.audit
    throw err
  }
  commit(T_SEL, T_ITEMS)
  return clone(selection)
}

function localUpdateMeta(id, meta) {
  const user = requireStaff()
  const d = getDb()
  const selection = d.selections.find((s) => s.id === id)
  if (!selection) throw new AppError('Výber sa nenašiel.', 'not_found')
  const old = clone(selection)
  Object.assign(selection, meta)
  touch(d, selection, user.id)
  audit(T_SEL, id, 'UPDATE', old, selection)
  commit(T_SEL)
  return clone(selection)
}

function localApply(id, meta, { added, removed, notes }) {
  const user = requireStaff()
  const d = getDb()
  const selection = d.selections.find((s) => s.id === id)
  if (!selection) throw new AppError('Výber sa nenašiel. Možno ho niekto zmazal.', 'not_found')
  const now = nowIso()
  if (Object.keys(meta).length) {
    const old = clone(selection)
    Object.assign(selection, meta)
    audit(T_SEL, id, 'UPDATE', old, selection)
  }
  const current = d.selection_items.filter((i) => i.selection_id === id)
  const present = new Set(current.map((i) => i.person_id))
  let order = current.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1
  const peopleIds = new Set(d.people.map((p) => p.id))
  for (const it of added) {
    if (present.has(it.personId) || !peopleIds.has(it.personId)) continue
    const row = { selection_id: id, person_id: it.personId, note: it.note, sort_order: order++, added_at: now, added_by: user.id, updated_at: now }
    d.selection_items.push(row)
    present.add(it.personId)
    audit(T_ITEMS, `${id}:${it.personId}`, 'INSERT', null, row)
  }
  if (removed.length) {
    const drop = new Set(removed)
    d.selection_items = d.selection_items.filter((i) => {
      if (i.selection_id === id && drop.has(i.person_id)) {
        audit(T_ITEMS, `${id}:${i.person_id}`, 'DELETE', i, null)
        return false
      }
      return true
    })
  }
  const lostNotes = []
  for (const it of notes) {
    const row = d.selection_items.find((i) => i.selection_id === id && i.person_id === it.personId)
    if (!row) {
      lostNotes.push(it)
      continue
    }
    const old = clone(row)
    row.note = it.note
    row.updated_at = now
    audit(T_ITEMS, `${id}:${it.personId}`, 'UPDATE', old, row)
  }
  touch(d, selection, user.id)
  commit(T_SEL, T_ITEMS)
  return { ...localGet(id), lostNotes }
}

function localDelete(id) {
  const user = requireStaff()
  const d = getDb()
  const selection = d.selections.find((s) => s.id === id)
  if (!selection) return
  if (user.role !== ROLES.ADMIN && selection.created_by !== user.id) {
    throw new AppError('Výber môže zmazať len jeho autor alebo správca.', 'forbidden')
  }
  audit(T_SEL, id, 'DELETE', selection, null)
  d.selections = d.selections.filter((s) => s.id !== id)
  d.selection_items = d.selection_items.filter((i) => i.selection_id !== id)
  commit(T_SEL, T_ITEMS)
}
