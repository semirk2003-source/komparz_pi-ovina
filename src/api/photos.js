// Fotografie sú v neverejnom úložisku. Na zobrazenie si vyžiadame dočasné
// podpísané odkazy — po dávkach a s pamäťou, aby zoznam s tisíckami
// dlaždíc neposielal tisíce požiadaviek.

import { IS_DEMO, supabase } from './backend.js'
import { BUCKETS, PHOTO_LIMITS } from '../constants/polia.js'
import { demoPhotoDataUrl, getDemoUpload } from './local/demoPhotos.js'

const cache = new Map() // path -> { url, expiresAt }
const pending = new Map() // path -> [resolve]
let flushTimer = null

const SAFETY_MS = 5 * 60 * 1000

function cached(path) {
  const hit = cache.get(path)
  if (hit && hit.expiresAt - SAFETY_MS > Date.now()) return hit.url
  return null
}

export function getCachedPhotoUrl(path) {
  if (!path) return null
  if (IS_DEMO) return resolveDemo(path)
  return cached(path)
}

function resolveDemo(path) {
  return getDemoUpload(path) || demoPhotoDataUrl(path)
}

export function getPhotoUrl(path) {
  if (!path) return Promise.resolve(null)
  if (IS_DEMO) return Promise.resolve(resolveDemo(path))
  const hit = cached(path)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const list = pending.get(path) || []
    list.push(resolve)
    pending.set(path, list)
    if (!flushTimer) flushTimer = setTimeout(flush, 16)
  })
}

async function flush() {
  flushTimer = null
  const batch = new Map(pending)
  pending.clear()
  const paths = [...batch.keys()]
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    let results
    try {
      const { data, error } = await supabase.storage
        .from(BUCKETS.PERSON_PHOTOS)
        .createSignedUrls(chunk, PHOTO_LIMITS.SIGNED_URL_SECONDS)
      if (error) throw error
      results = data || []
    } catch {
      results = []
    }
    const expiresAt = Date.now() + PHOTO_LIMITS.SIGNED_URL_SECONDS * 1000
    const byPath = new Map(results.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]))
    for (const path of chunk) {
      const url = byPath.get(path) || null
      if (url) cache.set(path, { url, expiresAt })
      for (const resolve of batch.get(path) || []) resolve(url)
    }
  }
}

export function forgetPhotoUrl(path) {
  cache.delete(path)
}
