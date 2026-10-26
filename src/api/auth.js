import { IS_DEMO, supabase, unwrap, AppError } from './backend.js'
import { TABLES, APP_USERS } from '../constants/polia.js'
import { getDb, getSessionUserId, setSessionUserId, subscribe } from './local/db.js'

// Cieľ odkazu v e-mailoch na obnovu hesla a v pozvánkach.
export const SET_PASSWORD_PATH = '/nastavit-heslo'

// Vracia { userId, email } alebo null.
export async function getSession() {
  if (IS_DEMO) {
    const id = getSessionUserId()
    const user = id && getDb().app_users.find((u) => u.id === id)
    return user ? { userId: user.id, email: user.email } : null
  }
  const { data } = await supabase.auth.getSession()
  const s = data.session
  return s ? { userId: s.user.id, email: s.user.email } : null
}

export function onAuthChange(callback) {
  if (IS_DEMO) {
    const handler = () => callback()
    window.addEventListener('komparz-demo-auth', handler)
    const unsub = subscribe((tables) => {
      if (tables.includes('app_users') || tables.includes('*')) callback()
    })
    return () => {
      window.removeEventListener('komparz-demo-auth', handler)
      unsub()
    }
  }
  if (!supabase) return () => {}
  // Supabase volá callback pod internou zámkou relácie; volanie DB priamo
  // v ňom (getSession, select z app_users) vie aplikáciu zaseknúť. Preto odložiť.
  const { data } = supabase.auth.onAuthStateChange(() => {
    setTimeout(callback, 0)
  })
  return () => data.subscription.unsubscribe()
}

export async function signIn(email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (IS_DEMO) {
    const user = getDb().app_users.find((u) => u.email === cleanEmail)
    if (!user || !password) throw new AppError('Nesprávny e-mail alebo heslo.', 'auth')
    setSessionUserId(user.id)
    window.dispatchEvent(new Event('komparz-demo-auth'))
    return
  }
  const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
  if (error) throw new AppError('Nesprávny e-mail alebo heslo.', 'auth', error)
}

export async function signOut() {
  if (IS_DEMO) {
    setSessionUserId(null)
    window.dispatchEvent(new Event('komparz-demo-auth'))
    return
  }
  await supabase.auth.signOut()
}

export async function requestPasswordReset(email) {
  if (IS_DEMO) return
  const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: `${window.location.origin}${SET_PASSWORD_PATH}`,
  })
  if (error) throw new AppError('Odkaz na obnovu hesla sa nepodarilo odoslať.', 'auth', error)
}

export async function updatePassword(password) {
  if (IS_DEMO) return
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new AppError('Heslo sa nepodarilo zmeniť.', 'auth', error)
}

// Profil prihláseného používateľa z app_users (rola, aktívnosť).
export async function getAppUser(userId) {
  if (IS_DEMO) {
    const user = getDb().app_users.find((u) => u.id === userId)
    return user ? { ...user } : null
  }
  const rows = unwrap(
    await supabase
      .from(TABLES.APP_USERS)
      .select([APP_USERS.ID, APP_USERS.EMAIL, APP_USERS.FULL_NAME, APP_USERS.ROLE, APP_USERS.IS_ACTIVE].join(','))
      .eq(APP_USERS.ID, userId)
      .limit(1),
  )
  return rows[0] || null
}

// Len pre demo režim: účty na rýchle prihlásenie.
export function listDemoAccounts() {
  if (!IS_DEMO) return []
  return getDb().app_users.filter((u) => u.is_active).map((u) => ({ email: u.email, role: u.role, full_name: u.full_name }))
}
