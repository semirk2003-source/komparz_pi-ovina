// Filtrovanie zoznamu ľudí v prehliadači (bez servera, < 100 ms pri 5000 profiloch).
// Čisté funkcie — žiadny React, dajú sa testovať samostatne.

import { AGE_DECADES, BRATISLAVA, NEW_PROFILE_DAYS, PEOPLE } from '../../constants/polia.js'
import { normalizeText } from '../../lib/format.js'

export const SORTS = Object.freeze([
  { value: 'name', label: 'Meno A–Ž' },
  { value: 'age_asc', label: 'Vek — od najmladších' },
  { value: 'age_desc', label: 'Vek — od najstarších' },
  { value: 'newest', label: 'Najnovšie profily' },
])

export const QUICK_FILTERS = Object.freeze([
  { key: 'dobovy', label: 'Dobový vzhľad' },
  { key: 'ba', label: 'Bratislava' },
  { key: 'text', label: 'Textujúci' },
  { key: 'novi', label: 'Noví v databáze' },
])

export const EMPTY_FILTERS = Object.freeze({
  q: '',
  genders: [],
  ages: [],
  sizes: [],
  regions: [],
  shoeMin: '',
  shoeMax: '',
  wave: '',
  quick: [],
  inactive: false,
  sort: 'name',
})

// ---------------------------------------------------------------------
// URL <-> filtre. Filtre žijú v adrese, aby prežili otvorenie detailu
// profilu (?osoba=…), návrat späť v prehliadači aj obnovenie stránky,
// a aby sa dal poslať odkaz na konkrétne vyhľadávanie kolegovi.
// ---------------------------------------------------------------------

const LIST_PARAMS = { genders: 'pohlavie', ages: 'vek', sizes: 'konfekcia', regions: 'region', quick: 'rychle' }
const SCALAR_PARAMS = { q: 'q', shoeMin: 'topankyOd', shoeMax: 'topankyDo', wave: 'vlna', sort: 'zoradit' }

export function parseFilters(params) {
  const f = { ...EMPTY_FILTERS }
  for (const [key, name] of Object.entries(LIST_PARAMS)) {
    const raw = params.get(name)
    f[key] = raw ? raw.split('|').filter(Boolean) : []
  }
  for (const [key, name] of Object.entries(SCALAR_PARAMS)) {
    f[key] = params.get(name) ?? EMPTY_FILTERS[key]
  }
  f.inactive = params.get('neaktivni') === '1'
  if (!SORTS.some((s) => s.value === f.sort)) f.sort = 'name'
  return f
}

export function writeFilters(params, filters) {
  const next = new URLSearchParams(params)
  for (const [key, name] of Object.entries(LIST_PARAMS)) {
    if (filters[key]?.length) next.set(name, filters[key].join('|'))
    else next.delete(name)
  }
  for (const [key, name] of Object.entries(SCALAR_PARAMS)) {
    const v = filters[key]
    if (v !== '' && v != null && v !== EMPTY_FILTERS[key]) next.set(name, String(v))
    else next.delete(name)
  }
  if (filters.inactive) next.set('neaktivni', '1')
  else next.delete('neaktivni')
  return next
}

// ---------------------------------------------------------------------
// Index a predikáty
// ---------------------------------------------------------------------

// Predpočíta sa raz po načítaní zoznamu — vyhľadávanie potom len porovnáva reťazce.
export function buildSearchIndex(people) {
  return people.map((p) => ({
    person: p,
    text: normalizeText(`${p.first_name} ${p.last_name} ${p.city || ''} ${p.notes || ''} ${p.legacy_id ?? ''}`),
    isBratislava: normalizeText(p.city).startsWith(normalizeText(BRATISLAVA)),
    createdMs: p.created_at ? new Date(p.created_at).getTime() : 0,
  }))
}

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
export { toggleValue }

/**
 * Z filtrov vyrobí zoznam aktívnych predikátov. Každý má:
 * { key, label, test(entry), clear(filters) → filters }
 * Rovnaký zoznam slúži na filtrovanie, na štítky aj na hľadanie najužšieho filtra.
 */
export function buildPredicates(filters, { waves = [], now = Date.now() } = {}) {
  const preds = []

  const q = normalizeText(filters.q)
  if (q) {
    const terms = q.split(' ')
    preds.push({
      key: 'q',
      label: `Hľadať: „${filters.q.trim()}"`,
      test: (e) => terms.every((t) => e.text.includes(t)),
      clear: (f) => ({ ...f, q: '' }),
    })
  }

  if (filters.genders.length) {
    const set = new Set(filters.genders)
    preds.push({
      key: 'genders',
      label: `Pohlavie: ${filters.genders.join(', ')}`,
      test: (e) => set.has(e.person[PEOPLE.GENDER]),
      clear: (f) => ({ ...f, genders: [] }),
    })
  }

  if (filters.ages.length) {
    const ranges = AGE_DECADES.filter((d) => filters.ages.includes(d.key))
    preds.push({
      key: 'ages',
      label: `Vek: ${ranges.map((r) => r.label).join(', ')}`,
      test: (e) => {
        const a = e.person[PEOPLE.AGE]
        return a != null && ranges.some((r) => a >= r.min && a <= r.max)
      },
      clear: (f) => ({ ...f, ages: [] }),
    })
  }

  if (filters.sizes.length) {
    const set = new Set(filters.sizes)
    preds.push({
      key: 'sizes',
      label: `Konfekcia: ${filters.sizes.join(', ')}`,
      test: (e) => set.has(e.person[PEOPLE.CLOTHING_SIZE]),
      clear: (f) => ({ ...f, sizes: [] }),
    })
  }

  const shoeMin = filters.shoeMin === '' ? null : Number(filters.shoeMin)
  const shoeMax = filters.shoeMax === '' ? null : Number(filters.shoeMax)
  if (Number.isFinite(shoeMin) || Number.isFinite(shoeMax)) {
    const min = Number.isFinite(shoeMin) ? shoeMin : -Infinity
    const max = Number.isFinite(shoeMax) ? shoeMax : Infinity
    const label = Number.isFinite(shoeMin) && Number.isFinite(shoeMax)
      ? `Topánky: ${shoeMin}–${shoeMax}`
      : Number.isFinite(shoeMin) ? `Topánky: od ${shoeMin}` : `Topánky: do ${shoeMax}`
    preds.push({
      key: 'shoes',
      label,
      test: (e) => {
        const s = e.person[PEOPLE.SHOE_SIZE]
        return s != null && Number(s) >= min && Number(s) <= max
      },
      clear: (f) => ({ ...f, shoeMin: '', shoeMax: '' }),
    })
  }

  if (filters.regions.length) {
    const set = new Set(filters.regions)
    preds.push({
      key: 'regions',
      label: `Región: ${filters.regions.join(', ')}`,
      test: (e) => set.has(e.person[PEOPLE.REGION]),
      clear: (f) => ({ ...f, regions: [] }),
    })
  }

  if (filters.wave) {
    const id = Number(filters.wave)
    const wave = waves.find((w) => w.id === id)
    preds.push({
      key: 'wave',
      label: `Registrácia: ${wave?.name || filters.wave}`,
      test: (e) => (e.person[PEOPLE.REGISTRATION_IDS] || []).includes(id),
      clear: (f) => ({ ...f, wave: '' }),
    })
  }

  const newSince = now - NEW_PROFILE_DAYS * 24 * 3600 * 1000
  const quickTests = {
    dobovy: (e) => !!e.person[PEOPLE.PERIOD_LOOK],
    ba: (e) => e.isBratislava,
    text: (e) => !!e.person[PEOPLE.SPEAKING_ROLE],
    novi: (e) => e.createdMs >= newSince,
  }
  for (const qf of QUICK_FILTERS) {
    if (!filters.quick.includes(qf.key)) continue
    preds.push({
      key: `quick:${qf.key}`,
      label: qf.label,
      test: quickTests[qf.key],
      clear: (f) => ({ ...f, quick: f.quick.filter((k) => k !== qf.key) }),
    })
  }

  return preds
}

// Základná podmienka, ktorá nie je „filter" v zmysle štítkov.
export function baseTest(filters) {
  return filters.inactive ? () => true : (e) => e.person[PEOPLE.IS_ACTIVE] !== false
}

export function applyPredicates(index, base, preds) {
  const out = []
  for (const e of index) {
    if (!base(e)) continue
    let ok = true
    for (const p of preds) {
      if (!p.test(e)) {
        ok = false
        break
      }
    }
    if (ok) out.push(e.person)
  }
  return out
}

// Koľko výsledkov by bolo bez jednotlivých filtrov — na radu „ktorý filter je najužší".
export function relaxationCounts(index, base, preds) {
  return preds.map((p, i) => {
    const rest = preds.filter((_, j) => j !== i)
    let n = 0
    for (const e of index) {
      if (!base(e)) continue
      if (rest.every((r) => r.test(e))) n++
    }
    return { predicate: p, count: n }
  })
}

const collator = new Intl.Collator('sk', { sensitivity: 'base' })

export function sortPeople(people, sort) {
  const list = people.slice()
  const byName = (a, b) =>
    collator.compare(a.last_name || '', b.last_name || '') || collator.compare(a.first_name || '', b.first_name || '') || a.id - b.id
  switch (sort) {
    case 'age_asc':
      return list.sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity) || byName(a, b))
    case 'age_desc':
      return list.sort((a, b) => (b.age ?? -Infinity) - (a.age ?? -Infinity) || byName(a, b))
    case 'newest':
      return list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || byName(a, b))
    default:
      return list.sort(byName)
  }
}

export function computeStats(people) {
  let ageSum = 0
  let ageCount = 0
  let ba = 0
  const baKey = normalizeText(BRATISLAVA)
  for (const p of people) {
    if (p.age != null) {
      ageSum += p.age
      ageCount++
    }
    if (normalizeText(p.city).startsWith(baKey)) ba++
  }
  return {
    count: people.length,
    avgAge: ageCount ? Math.round((ageSum / ageCount) * 10) / 10 : null,
    bratislava: ba,
  }
}

export function hasActiveFilters(filters) {
  return (
    !!filters.q.trim() || filters.genders.length > 0 || filters.ages.length > 0 || filters.sizes.length > 0 ||
    filters.regions.length > 0 || filters.shoeMin !== '' || filters.shoeMax !== '' || !!filters.wave || filters.quick.length > 0
  )
}
