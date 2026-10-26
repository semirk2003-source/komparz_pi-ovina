// Obľúbení — osobné označenie profilu. Každý vidí len svoje (RLS favorites_own).

import { IS_DEMO, supabase, unwrap } from './backend.js'
import { TABLES, FAVORITES } from '../constants/polia.js'
import { getDb, requireUser, commit, nowIso, delay } from './local/db.js'

export async function listFavoriteIds() {
  if (IS_DEMO) {
    const user = requireUser()
    return delay(getDb().favorites.filter((f) => f.user_id === user.id).map((f) => f.person_id))
  }
  const rows = unwrap(await supabase.from(TABLES.FAVORITES).select(FAVORITES.PERSON_ID))
  return rows.map((r) => r.person_id)
}

// Nastaví stav obľúbenosti. Vracia nový stav (true = obľúbený).
export async function setFavorite(personId, favorite) {
  const pid = Number(personId)
  if (IS_DEMO) {
    const user = requireUser()
    const d = getDb()
    d.favorites = d.favorites.filter((f) => !(f.user_id === user.id && f.person_id === pid))
    if (favorite) d.favorites.push({ user_id: user.id, person_id: pid, created_at: nowIso() })
    commit(TABLES.FAVORITES)
    return delay(!!favorite)
  }
  if (favorite) {
    unwrap(
      await supabase
        .from(TABLES.FAVORITES)
        .upsert({ [FAVORITES.PERSON_ID]: pid }, { onConflict: `${FAVORITES.USER_ID},${FAVORITES.PERSON_ID}`, ignoreDuplicates: true }),
    )
  } else {
    unwrap(await supabase.from(TABLES.FAVORITES).delete().eq(FAVORITES.PERSON_ID, pid))
  }
  return !!favorite
}

export async function toggleFavorite(personId) {
  const ids = await listFavoriteIds()
  return setFavorite(personId, !ids.includes(Number(personId)))
}
