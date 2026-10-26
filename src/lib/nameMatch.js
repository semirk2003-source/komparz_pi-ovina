// Párovanie mien zo súpisky na profily. Čisté funkcie bez závislostí.
//
// Systém len NAVRHUJE. Ani skóre 1.0 nie je potvrdenie — v databáze sú
// rôzni ľudia s rovnakým menom (napr. Diana Vranová dvakrát).

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim()
}

// Mená s poradím slov zoradeným abecedne — „Novák Ján" == „Ján Novák".
export function sortedTokens(value) {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ')
}

export function jaroWinkler(a, b) {
  if (a === b) return a.length ? 1 : 0
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array(a.length).fill(false)
  const bMatches = new Array(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - range)
    const end = Math.min(i + range + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

const keyCache = new WeakMap()

function personKeys(person) {
  let keys = keyCache.get(person)
  if (!keys) {
    const first = person.first_name || ''
    const last = person.last_name || ''
    keys = {
      forward: normalizeName(`${first} ${last}`),
      reverse: normalizeName(`${last} ${first}`),
      sorted: sortedTokens(`${first} ${last}`),
    }
    keyCache.set(person, keys)
  }
  return keys
}

// Podobnosť mena zo súpisky s profilom, 0 až 1.
export function nameScore(rawName, person) {
  const raw = normalizeName(rawName)
  if (!raw) return 0
  const keys = personKeys(person)
  if (raw === keys.forward || raw === keys.reverse) return 1
  const rawSorted = sortedTokens(rawName)
  if (rawSorted === keys.sorted) return 0.98
  return Math.max(
    jaroWinkler(raw, keys.forward),
    jaroWinkler(raw, keys.reverse) * 0.98,
    jaroWinkler(rawSorted, keys.sorted) * 0.97,
  )
}

/**
 * Návrhy profilov pre meno zo súpisky, najlepšie prvé.
 * @returns [{ person, score }]
 */
export function suggestPeople(rawName, people, { limit = 5, minScore = 0.8 } = {}) {
  const raw = normalizeName(rawName)
  if (!raw) return []
  const out = []
  for (const person of people) {
    const score = nameScore(rawName, person)
    if (score >= minScore) out.push({ person, score })
  }
  out.sort((a, b) => b.score - a.score || a.person.id - b.person.id)
  return out.slice(0, limit)
}

// Počet profilov s presne rovnakým menom (bez diakritiky) — varovanie pred menovcami.
export function countNamesakes(person, people) {
  const key = personKeys(person).forward
  let n = 0
  for (const p of people) if (personKeys(p).forward === key) n++
  return n
}

/**
 * Najlepší návrh pre hromadné vkladanie.
 * ambiguous = viac profilov s takmer rovnakým skóre (menovci) — návrh treba overiť.
 */
export function bestSuggestion(rawName, people, { minScore = 0.88 } = {}) {
  const list = suggestPeople(rawName, people, { limit: 5, minScore })
  if (list.length === 0) return null
  const [top, second] = list
  return { ...top, ambiguous: !!second && top.score - second.score < 0.02, alternatives: list }
}

// Zoskupenie variantov názvov (Čašník / čašník / Čašnik) — návrh na zlúčenie.
export function groupNameVariants(values) {
  const groups = new Map()
  for (const v of values) {
    const key = normalizeName(v.raw_value)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(v)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}
