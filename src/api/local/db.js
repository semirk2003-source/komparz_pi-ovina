// Lokálna demo databáza v prehliadači. Napodobňuje správanie Supabase
// vrátane prístupových pravidiel (viewer nedostane kontakty), aby sa
// aplikácia dala vyvíjať a testovať ešte pred založením databázy.

import { AppError } from '../backend.js'
import { ROLES } from '../../constants/polia.js'
import { generateSeed, SEED_VERSION } from './seed.js'

const STORAGE_KEY = 'komparz-demo-db-v1'
const SESSION_KEY = 'komparz-demo-session-v1'
const CHANNEL_NAME = 'komparz-demo'

let db = null
let channel = null
const listeners = new Set()

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    // Dáta zo staršej verzie generátora zahodíme, inak by aplikácia pracovala s neúplnou štruktúrou.
    if (parsed && parsed.version === SEED_VERSION) return parsed
  } catch {
    // poškodené alebo nedostupné úložisko — vygenerujeme nové
  }
  const size = Number(import.meta.env.VITE_DEMO_PEOPLE) || 800
  return generateSeed(size)
}

export function getDb() {
  if (!db) {
    db = load()
    persist()
  }
  return db
}

// Veľký demo dataset (napr. 5000 profilov ≈ 12 MB) sa do localStorage (~5 MB)
// nezmestí. Po prvom neúspechu už neukladáme — serializácia pri každej zmene
// by zbytočne sekala UI a skresľovala meranie rýchlosti.
let persistDisabled = false

export function isDemoPersistent() {
  return !persistDisabled
}

function persist() {
  if (persistDisabled) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    persistDisabled = true
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // nedostupné úložisko
    }
    console.warn('Demo dáta sa nezmestia do úložiska prehliadača — zmeny sa po obnovení stránky stratia.')
  }
}

// Zavolá sa po každej zmene. Uloží dáta a oznámi zmenu ostatným kartám.
export function commit(...tables) {
  const d = getDb()
  d.rev = (d.rev || 0) + 1
  persist()
  for (const fn of listeners) fn(tables)
  getChannel()?.postMessage({ tables })
}

function getChannel() {
  if (channel !== null) return channel
  if (typeof BroadcastChannel === 'undefined') return (channel = undefined)
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event) => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
      // Staršiu verziu (napr. keď sa novšia nezmestila do úložiska) nenačítavame,
      // inak by sme pri ďalšom uložení prepísali novšie zmeny.
      if (stored && stored.version === SEED_VERSION && (stored.rev || 0) >= (db?.rev || 0)) db = stored
    } catch {
      // ponecháme dáta v pamäti
    }
    for (const fn of listeners) fn(event.data?.tables || [])
  }
  return channel
}

// Odber zmien (náhrada za Supabase Realtime). Vracia funkciu na odhlásenie.
export function subscribe(fn) {
  getChannel()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetDemoDb() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nič
  }
  persistDisabled = false
  db = null
  getDb()
  commit('*')
}

export function nextId(table) {
  const d = getDb()
  d.seq[table] = (d.seq[table] || 0) + 1
  return d.seq[table]
}

export function nowIso() {
  return new Date().toISOString()
}

export function clone(value) {
  return structuredClone(value)
}

// ---------------------------------------------------------------------
// Relácia a oprávnenia
// ---------------------------------------------------------------------

export function getSessionUserId() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function setSessionUserId(id) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // nič
  }
}

export function currentAppUser() {
  const id = getSessionUserId()
  if (!id) return null
  const user = getDb().app_users.find((u) => u.id === id)
  return user && user.is_active ? user : null
}

export function requireUser() {
  const user = currentAppUser()
  if (!user) throw new AppError('Nie ste prihlásený.', 'forbidden')
  return user
}

export function requireStaff() {
  const user = requireUser()
  if (user.role !== ROLES.ADMIN && user.role !== ROLES.CASTER) {
    throw new AppError('Na túto akciu nemáte oprávnenie.', 'forbidden')
  }
  return user
}

export function requireAdmin() {
  const user = requireUser()
  if (user.role !== ROLES.ADMIN) throw new AppError('Na túto akciu nemáte oprávnenie.', 'forbidden')
  return user
}

export function isStaff(user = currentAppUser()) {
  return !!user && (user.role === ROLES.ADMIN || user.role === ROLES.CASTER)
}

// Napodobenie triggera audit_log.
export function audit(tableName, rowId, action, oldData, newData) {
  const d = getDb()
  d.audit_log.push({
    id: nextId('audit_log'),
    table_name: tableName,
    row_id: String(rowId),
    action,
    old_data: oldData ?? null,
    new_data: newData ?? null,
    changed_by: getSessionUserId(),
    changed_at: nowIso(),
  })
}

export function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0))
}
