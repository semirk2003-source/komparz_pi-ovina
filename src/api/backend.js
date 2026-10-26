import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const configured = Boolean(url && anonKey)
const demoRequested = import.meta.env.VITE_DEMO_MODE === 'true'

// Bez prístupových údajov beží aplikácia počas vývoja v demo režime nad
// lokálnymi dátami v prehliadači. Po doplnení .env.local sa prepne na Supabase.
// Produkčný build bez údajov demo NEspustí sám od seba — ľudia by doň zadávali
// skutočné údaje, ktoré by zostali len v jednom prehliadači. Demo na internete
// sa dá zapnúť výslovne cez VITE_DEMO_MODE=true.
export const IS_DEMO = demoRequested || (!configured && !import.meta.env.PROD)

// Produkčný build bez prístupových údajov a bez výslovného demo režimu.
export const IS_MISCONFIGURED = !IS_DEMO && !configured

export const supabase = IS_DEMO || IS_MISCONFIGURED
  ? null
  : createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })

// Supabase vracia { data, error }; tu z chyby robíme výnimku so slovenskou hláškou.
export function unwrap({ data, error }) {
  if (error) throw toAppError(error)
  return data
}

export function toAppError(error) {
  if (error instanceof AppError) return error
  const code = error?.code
  if (code === '23505') return new AppError('Takýto záznam už existuje.', 'duplicate', error)
  if (code === '23503') {
    return new AppError('Súvisiaci záznam medzitým niekto zmazal. Obnovte stránku.', 'missing_reference', error)
  }
  if (code === '42501') {
    return new AppError('Na túto akciu nemáte oprávnenie.', 'forbidden', error)
  }
  if (code === 'PGRST301' || code === 'PGRST303') {
    return new AppError('Platnosť prihlásenia vypršala. Prihláste sa, prosím, znova.', 'auth', error)
  }
  if (code === 'PGRST116') return new AppError('Záznam sa nenašiel.', 'not_found', error)
  if (error?.name === 'TypeError' && /fetch/i.test(error?.message || '')) {
    return new AppError('Nepodarilo sa spojiť so serverom. Skontrolujte pripojenie na internet.', 'network', error)
  }
  if (code === '23514') return new AppError(error.message || 'Hodnota nespĺňa pravidlá databázy.', 'check', error)
  return new AppError(error?.message || 'Nastala neočakávaná chyba.', code || 'unknown', error)
}

export class AppError extends Error {
  constructor(message, code = 'unknown', cause) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.cause = cause
  }
}

const PARALLEL_PAGES = 4

// Načíta všetky riadky po stránkach. Dopyt musí mať stabilné zoradenie (order).
// Server môže mať limit riadkov (Max rows) nižší než pageSize — stránka potom
// príde kratšia, hoci dáta pokračujú. Preto skutočnú veľkosť stránky zistíme
// z prvej odpovede a končíme až pri prázdnej alebo neúplnej stránke.
export async function fetchAllPages(buildQuery, pageSize = 1000) {
  const fetchRange = async (from, size) => unwrap(await buildQuery().range(from, from + size - 1)) || []

  const first = await fetchRange(0, pageSize)
  if (first.length === 0) return []
  const rows = [...first]

  if (first.length < pageSize) {
    // Buď je to všetko, alebo server vracia menej, než sme žiadali.
    const next = await fetchRange(first.length, pageSize)
    if (next.length === 0) return rows
    rows.push(...next)
    if (next.length < first.length) return rows
  }

  const step = Math.min(first.length, pageSize)
  for (;;) {
    const from = rows.length
    const pages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, i) => fetchRange(from + i * step, step)),
    )
    for (const page of pages) {
      rows.push(...page)
      if (page.length < step) return rows
    }
  }
}
