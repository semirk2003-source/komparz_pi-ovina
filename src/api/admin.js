// Správa používateľov, rolí a registračných vĺn (UC-13). Len pre správcu.
// Odobratie prístupu = deaktivácia účtu. Účty sa nikdy nemažú, aby výbery
// a záznamy, ktoré človek vytvoril, zostali tímu.

import { IS_DEMO, supabase, unwrap, AppError } from './backend.js'
import {
  TABLES, APP_USERS, ROLES, REGISTRATIONS, PERSON_REGISTRATIONS,
} from '../constants/polia.js'
import { SET_PASSWORD_PATH } from './auth.js'
import { getDb, requireAdmin, audit, commit, nextId, nowIso, clone, delay } from './local/db.js'

const USER_COLUMNS = [APP_USERS.ID, APP_USERS.EMAIL, APP_USERS.FULL_NAME, APP_USERS.ROLE, APP_USERS.IS_ACTIVE, 'created_at'].join(',')
const VALID_ROLES = Object.values(ROLES)

// ---------------------------------------------------------------------
// Používatelia
// ---------------------------------------------------------------------

export async function listUsers() {
  if (IS_DEMO) {
    requireAdmin()
    return delay(clone(getDb().app_users).sort(byName))
  }
  const rows = unwrap(await supabase.from(TABLES.APP_USERS).select(USER_COLUMNS))
  return rows.sort(byName)
}

function byName(a, b) {
  return (a.full_name || a.email).localeCompare(b.full_name || b.email, 'sk')
}

function validateRole(role) {
  if (!VALID_ROLES.includes(role)) throw new AppError('Neplatná rola.', 'check')
}

function validateEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new AppError('Zadajte platný e-mail.', 'check')
  return e
}

// Pozvánka e-mailom. V Supabase ju posiela Edge Function invite-user
// (potrebuje service_role kľúč, ktorý v prehliadači byť nesmie).
export async function inviteUser({ email, full_name, role }) {
  const cleanEmail = validateEmail(email)
  validateRole(role)
  const name = String(full_name || '').trim() || cleanEmail.split('@')[0]

  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    const existing = d.app_users.find((u) => u.email === cleanEmail)
    if (existing) throw new AppError('Používateľ s týmto e-mailom už existuje.', 'duplicate')
    const user = {
      id: `demo-user-${nextId('app_users')}`,
      email: cleanEmail,
      full_name: name,
      role,
      is_active: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    d.app_users.push(user)
    audit(TABLES.APP_USERS, user.id, 'INSERT', null, user)
    commit(TABLES.APP_USERS)
    return delay(clone(user))
  }

  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email: cleanEmail, full_name: name, role, redirect_to: `${window.location.origin}${SET_PASSWORD_PATH}` },
  })
  if (error) {
    let message = 'Pozvánku sa nepodarilo odoslať.'
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // ponecháme všeobecnú hlášku
    }
    throw new AppError(message, 'invite', error)
  }
  return data?.user ?? null
}

function assertNotLastAdmin(users, targetId, nextRole, nextActive) {
  const target = users.find((u) => u.id === targetId)
  if (!target || target.role !== ROLES.ADMIN || !target.is_active) return
  const losesAdmin = nextRole !== ROLES.ADMIN || !nextActive
  if (!losesAdmin) return
  const otherAdmins = users.filter((u) => u.id !== targetId && u.role === ROLES.ADMIN && u.is_active)
  if (otherAdmins.length === 0) {
    throw new AppError('Toto je posledný aktívny správca. Najprv určte iného správcu.', 'last_admin')
  }
}

async function updateUser(id, patch) {
  if (patch.role !== undefined) validateRole(patch.role)

  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    const user = d.app_users.find((u) => u.id === id)
    if (!user) throw new AppError('Používateľ neexistuje.', 'not_found')
    assertNotLastAdmin(d.app_users, id, patch.role ?? user.role, patch.is_active ?? user.is_active)
    const before = clone(user)
    Object.assign(user, patch, { updated_at: nowIso() })
    audit(TABLES.APP_USERS, id, 'UPDATE', before, clone(user))
    commit(TABLES.APP_USERS)
    return delay(clone(user))
  }

  const users = unwrap(await supabase.from(TABLES.APP_USERS).select(USER_COLUMNS))
  const target = users.find((u) => u.id === id)
  if (!target) throw new AppError('Používateľ neexistuje.', 'not_found')
  assertNotLastAdmin(users, id, patch.role ?? target.role, patch.is_active ?? target.is_active)
  const rows = unwrap(await supabase.from(TABLES.APP_USERS).update(patch).eq(APP_USERS.ID, id).select(USER_COLUMNS))
  if (!rows.length) throw new AppError('Na túto akciu nemáte oprávnenie.', 'forbidden')
  return rows[0]
}

export function setUserRole(id, role) {
  return updateUser(id, { [APP_USERS.ROLE]: role })
}

// false = odobrať prístup (účet ani jeho práca sa nemažú)
export function setUserActive(id, isActive) {
  return updateUser(id, { [APP_USERS.IS_ACTIVE]: !!isActive })
}

export function setUserName(id, fullName) {
  return updateUser(id, { [APP_USERS.FULL_NAME]: String(fullName || '').trim() || null })
}

// ---------------------------------------------------------------------
// Registračné vlny
// ---------------------------------------------------------------------

const REG_FIELDS = [REGISTRATIONS.NAME, REGISTRATIONS.PERIOD_START, REGISTRATIONS.PERIOD_END, REGISTRATIONS.NOTE]

function cleanRegistration(input) {
  const out = {}
  for (const f of REG_FIELDS) {
    if (input[f] === undefined) continue
    const v = typeof input[f] === 'string' ? input[f].trim() : input[f]
    out[f] = v === '' ? null : v
  }
  if (out.name !== undefined && !out.name) throw new AppError('Vlna musí mať názov.', 'check')
  if (out.period_start && out.period_end && out.period_start > out.period_end) {
    throw new AppError('Začiatok obdobia je po jeho konci.', 'check')
  }
  return out
}

// Vracia vlny aj s počtom ľudí: [{ id, name, period_start, period_end, note, people_count }]
export async function listRegistrations() {
  if (IS_DEMO) {
    const d = getDb()
    const counts = new Map()
    for (const r of d.person_registrations) counts.set(r.registration_id, (counts.get(r.registration_id) || 0) + 1)
    return delay(
      clone(d.registrations)
        .map((r) => ({ ...r, people_count: counts.get(r.id) || 0 }))
        .sort((a, b) => String(b.period_start || '').localeCompare(String(a.period_start || ''))),
    )
  }
  const rows = unwrap(
    await supabase
      .from(TABLES.REGISTRATIONS)
      .select(`${REGISTRATIONS.ID},${REG_FIELDS.join(',')},${TABLES.PERSON_REGISTRATIONS}(count)`)
      .order(REGISTRATIONS.PERIOD_START, { ascending: false, nullsFirst: false }),
  )
  return rows.map(({ [TABLES.PERSON_REGISTRATIONS]: agg, ...r }) => ({ ...r, people_count: agg?.[0]?.count ?? 0 }))
}

export async function createRegistration(input) {
  const values = cleanRegistration(input)
  if (!values.name) throw new AppError('Vlna musí mať názov.', 'check')
  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    if (d.registrations.some((r) => r.name.toLowerCase() === values.name.toLowerCase())) {
      throw new AppError('Vlna s týmto názvom už existuje.', 'duplicate')
    }
    const row = { id: nextId('registrations'), period_start: null, period_end: null, note: null, ...values, created_at: nowIso() }
    d.registrations.push(row)
    commit(TABLES.REGISTRATIONS)
    return delay({ ...clone(row), people_count: 0 })
  }
  const rows = unwrap(await supabase.from(TABLES.REGISTRATIONS).insert(values).select())
  return { ...rows[0], people_count: 0 }
}

export async function updateRegistration(id, input) {
  const values = cleanRegistration(input)
  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    const row = d.registrations.find((r) => r.id === id)
    if (!row) throw new AppError('Vlna neexistuje.', 'not_found')
    if (values.name && d.registrations.some((r) => r.id !== id && r.name.toLowerCase() === values.name.toLowerCase())) {
      throw new AppError('Vlna s týmto názvom už existuje.', 'duplicate')
    }
    Object.assign(row, values)
    commit(TABLES.REGISTRATIONS)
    return delay(clone(row))
  }
  const rows = unwrap(await supabase.from(TABLES.REGISTRATIONS).update(values).eq(REGISTRATIONS.ID, id).select())
  if (!rows.length) throw new AppError('Na túto akciu nemáte oprávnenie.', 'forbidden')
  return rows[0]
}

// Zmazať sa dá len prázdna vlna — inak by sa stratila informácia, odkiaľ ľudia prišli.
export async function deleteRegistration(id) {
  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    if (d.person_registrations.some((r) => r.registration_id === id)) {
      throw new AppError('Vlnu nemožno zmazať, sú v nej ľudia.', 'check')
    }
    d.registrations = d.registrations.filter((r) => r.id !== id)
    commit(TABLES.REGISTRATIONS)
    return delay(true)
  }
  const { count, error } = await supabase
    .from(TABLES.PERSON_REGISTRATIONS)
    .select(PERSON_REGISTRATIONS.PERSON_ID, { count: 'exact', head: true })
    .eq(PERSON_REGISTRATIONS.REGISTRATION_ID, id)
  if (error) throw new AppError(error.message, 'unknown', error)
  if (count > 0) throw new AppError('Vlnu nemožno zmazať, sú v nej ľudia.', 'check')
  unwrap(await supabase.from(TABLES.REGISTRATIONS).delete().eq(REGISTRATIONS.ID, id))
  return true
}

// ---------------------------------------------------------------------
// Systém — prehľad počtov
// ---------------------------------------------------------------------

const STAT_TABLES = [
  [TABLES.PEOPLE, 'Profily'],
  [TABLES.PERSON_PHOTOS, 'Fotografie'],
  [TABLES.APPEARANCES, 'Záznamy v archíve'],
  [TABLES.SELECTIONS, 'Uložené výbery'],
  [TABLES.REGISTRATIONS, 'Registračné vlny'],
  [TABLES.APP_USERS, 'Používatelia'],
  [TABLES.AUDIT_LOG, 'Záznamy zmien'],
]

export async function getSystemStats() {
  if (IS_DEMO) {
    requireAdmin()
    const d = getDb()
    return delay(STAT_TABLES.map(([table, label]) => ({ table, label, count: d[table]?.length ?? 0 })))
  }
  return Promise.all(
    STAT_TABLES.map(async ([table, label]) => {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
      return { table, label, count: error ? null : count }
    }),
  )
}
