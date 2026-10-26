import { useEffect, useState } from 'react'
import { getCachedPhotoUrl, getPhotoUrl } from '../api/photos.js'

// { url, status: 'empty' | 'loading' | 'ready' | 'error' }
export function usePhotoUrlState(path) {
  const [result, setResult] = useState({ path: null, url: null })

  useEffect(() => {
    if (!path || getCachedPhotoUrl(path)) return undefined
    let alive = true
    getPhotoUrl(path).then((url) => {
      if (alive) setResult({ path, url })
    })
    return () => {
      alive = false
    }
  }, [path])

  if (!path) return { url: null, status: 'empty' }
  const cached = getCachedPhotoUrl(path)
  if (cached) return { url: cached, status: 'ready' }
  // Výsledok k inej (staršej) ceste ignorujeme — pri rolovaní sa dlaždice recyklujú.
  if (result.path !== path) return { url: null, status: 'loading' }
  return result.url ? { url: result.url, status: 'ready' } : { url: null, status: 'error' }
}

// Vráti dočasný odkaz na fotografiu z neverejného úložiska (alebo null).
export function usePhotoUrl(path) {
  return usePhotoUrlState(path).url
}
