// Plánovanie zmien pravidiel zjednocovania názvov (postavy, projekty, série).
//
// Pravidlá sa držia PLOCHÉ: každá pôvodná hodnota ukazuje priamo na konečný
// názov (A→C), nikdy cez medzikrok (A→B→C). Pohľad appearances_effective totiž
// aplikuje len jeden krok. Pôvodné hodnoty v archíve sa nikdy nemenia — mení sa
// len tabuľka pravidiel, a každý plán sa dá vrátiť cez invertChanges().
//
// values: výstup listNameValues — [{ raw_value, occurrences, alias: { canonical_value, is_excluded } | null }]
// zmena:  { raw_value, before: rule | null, rule: rule | null }, rule = { canonical_value, is_excluded }

function ruleOf(alias) {
  return alias ? { canonical_value: alias.canonical_value ?? null, is_excluded: !!alias.is_excluded } : null
}

function sameRule(a, b) {
  if (!a || !b) return a === b
  return (a.canonical_value ?? null) === (b.canonical_value ?? null) && !!a.is_excluded === !!b.is_excluded
}

function indexValues(values) {
  return new Map(values.map((v) => [v.raw_value, v]))
}

// Hodnoty, ktorých pravidlo ukazuje na niektorú z daných hodnôt (ich varianty).
export function variantsOf(values, raws) {
  const targets = new Set(raws)
  return values.filter((v) => v.alias?.canonical_value != null && targets.has(v.alias.canonical_value)).map((v) => v.raw_value)
}

function finalize(byRaw, desired) {
  const changes = []
  for (const [raw, rule] of desired) {
    const before = ruleOf(byRaw.get(raw)?.alias)
    if (!sameRule(before, rule)) changes.push({ raw_value: raw, before, rule })
  }
  return changes
}

/**
 * Zlúčiť hodnoty pod spoločný názov. Ak už iné hodnoty ukazujú na zlučovanú
 * hodnotu, presmerujú sa tiež na nový názov (A→B, B→C ⇒ A→C).
 */
export function planMerge(values, raws, target) {
  const byRaw = indexValues(values)
  const name = String(target ?? '').trim()
  if (!name) throw new Error('Zadajte spoločný názov.')
  // Ak je cieľ sám zlúčený pod iný názov, zlučujeme rovno pod ten konečný.
  const targetRule = byRaw.get(name)?.alias
  const finalName = targetRule?.canonical_value ? targetRule.canonical_value : name

  const selected = new Set(raws)
  const desired = new Map()
  const apply = (raw, keepExcluded) => {
    if (raw === finalName) {
      // Konečný názov nepotrebuje pravidlo na seba; vyradenie ponecháme, ak nebol vybraný.
      const current = byRaw.get(raw)?.alias
      desired.set(raw, keepExcluded && current?.is_excluded ? { canonical_value: null, is_excluded: true } : null)
      return
    }
    const current = byRaw.get(raw)?.alias
    desired.set(raw, { canonical_value: finalName, is_excluded: keepExcluded ? !!current?.is_excluded : false })
  }
  for (const raw of selected) apply(raw, false)
  for (const raw of variantsOf(values, [...selected, name])) if (!selected.has(raw)) apply(raw, true)
  return finalize(byRaw, desired)
}

/**
 * Vyradiť hodnoty. withVariants = vyradiť aj všetky hodnoty zlúčené pod nimi
 * (inak by sa varianty v archíve ďalej zobrazovali pod vyradeným názvom).
 */
export function planExclude(values, raws, { withVariants = true } = {}) {
  const byRaw = indexValues(values)
  const all = new Set(raws)
  if (withVariants) for (const raw of variantsOf(values, raws)) all.add(raw)
  const desired = new Map()
  for (const raw of all) {
    const current = byRaw.get(raw)?.alias
    desired.set(raw, { canonical_value: current?.canonical_value ?? null, is_excluded: true })
  }
  return finalize(byRaw, desired)
}

// Zrušiť pravidlá — hodnoty sa vrátia do pôvodného stavu.
export function planClear(values, raws) {
  const byRaw = indexValues(values)
  return finalize(byRaw, new Map(raws.map((raw) => [raw, null])))
}

// Plán, ktorý vráti stav pred vykonaním daných zmien.
export function invertChanges(changes) {
  return changes.map((c) => ({ raw_value: c.raw_value, before: c.rule, rule: c.before }))
}
