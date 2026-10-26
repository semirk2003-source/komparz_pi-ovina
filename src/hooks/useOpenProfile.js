import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export const PROFILE_PARAM = 'osoba'

// Detail profilu sa otvára cez parameter v adrese (?osoba=123), takže
// funguje z ktorejkoľvek obrazovky a dá sa naň poslať odkaz.
export function useOpenProfile() {
  const [, setParams] = useSearchParams()
  return useCallback(
    (personId) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (personId == null) next.delete(PROFILE_PARAM)
        else next.set(PROFILE_PARAM, String(personId))
        return next
      })
    },
    [setParams],
  )
}

export function useOpenProfileId() {
  const [params] = useSearchParams()
  const raw = params.get(PROFILE_PARAM)
  const id = raw ? Number(raw) : null
  return Number.isFinite(id) ? id : null
}
