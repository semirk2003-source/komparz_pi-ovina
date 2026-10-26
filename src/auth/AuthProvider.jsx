import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AuthContext, permissionsFor } from './AuthContext.js'
import { getAppUser, getSession, onAuthChange, signOut as apiSignOut } from '../api/auth.js'
import { CURRENT_SELECTION_STORAGE_KEY, SIGN_OUT_EVENT } from '../state/currentSelectionReducer.js'

const NO_PERMISSIONS = Object.freeze({ canEdit: false, canExport: false, canSeeContacts: false, isAdmin: false })

async function loadAuthState() {
  try {
    const session = await getSession()
    if (!session) return { status: 'signedOut', user: null }
    const appUser = await getAppUser(session.userId)
    if (!appUser || !appUser.is_active) {
      return { status: 'inactive', user: appUser || { id: session.userId, email: session.email } }
    }
    return { status: 'ready', user: appUser }
  } catch {
    // Výpadok siete či servera — nie dôvod používateľa odhlásiť.
    return { status: 'error', user: null }
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState({ status: 'loading', user: null })
  const seqRef = useRef(0)
  const userIdRef = useRef(null)

  // Odpovede môžu prísť v inom poradí, než sa pýtali (rýchle odhlásenie
  // a prihlásenie) — platí len posledná.
  const run = useCallback(() => {
    const seq = ++seqRef.current
    return loadAuthState().then((next) => {
      if (seq !== seqRef.current) return
      setState((prev) => {
        if (next.status === 'error') return prev.status === 'loading' ? { status: 'signedOut', user: null } : prev
        return next
      })
      const nextUserId = next.status === 'error' ? userIdRef.current : next.user?.id ?? null
      if (nextUserId !== userIdRef.current) {
        // Iný používateľ (alebo nikto) — dáta predchádzajúceho nesmú zostať v cache.
        if (userIdRef.current !== null) queryClient.clear()
        userIdRef.current = nextUserId
      }
    })
  }, [queryClient])

  useEffect(() => {
    const seqCounter = seqRef
    run()
    const unsubscribe = onAuthChange(run)
    return () => {
      // Odpovede, ktoré dobehnú po odpojení, sa zahodia.
      seqCounter.current++
      unsubscribe()
    }
  }, [run])

  const signOut = useCallback(async () => {
    window.dispatchEvent(new Event(SIGN_OUT_EVENT))
    try {
      localStorage.removeItem(CURRENT_SELECTION_STORAGE_KEY)
    } catch {
      // nedostupné úložisko
    }
    await apiSignOut()
    queryClient.clear()
    await run()
  }, [queryClient, run])

  const value = useMemo(
    () => ({
      ...state,
      permissions: state.status === 'ready' ? permissionsFor(state.user.role) : NO_PERMISSIONS,
      signOut,
      refresh: run,
    }),
    [state, signOut, run],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
