import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeader, Button, Input, Badge, Checkbox, Spinner, ErrorMessage, EmptyState, Card } from '../../components/ui.jsx'
import { useToast } from '../../components/toast/ToastContext.js'
import { ALIAS_KIND, ALIAS_KIND_LABELS } from '../../constants/polia.js'
import { normalizeText, countLabel } from '../../lib/format.js'
import { groupNameVariants } from '../../lib/nameMatch.js'
import { applyAliasChanges } from '../../api/archive.js'
import { planClear, planExclude, planMerge, invertChanges, variantsOf } from '../../lib/aliasPlan.js'
import { ARCHIVE_KEY, useNameValues } from './archiveQueries.js'
import { cx } from '../../lib/cx.js'

const KINDS = [ALIAS_KIND.ROLE, ALIAS_KIND.PRODUCTION, ALIAS_KIND.SERIES]

// UC-09: zjednotenie názvov postáv, projektov a sérií.
// Pôvodná hodnota sa nikdy neprepisuje — pravidlo sa dá kedykoľvek zrušiť.
export function AliasesPage() {
  const [kind, setKind] = useState(ALIAS_KIND.ROLE)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Správa názvov"
        subtitle="Zlúčte preklepy a varianty pod jeden názov alebo nepoužiteľné hodnoty vyraďte. Pôvodné hodnoty v archíve zostávajú nezmenené."
      />
      <div className="flex gap-1 border-b border-stone-200" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              kind === k ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800',
            )}
          >
            {ALIAS_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <AliasesTab key={kind} kind={kind} />
    </div>
  )
}

function ruleLabel(alias) {
  if (!alias) return null
  if (alias.is_excluded) return <Badge tone="danger">vyradené</Badge>
  return <Badge tone="info">→ {alias.canonical_value}</Badge>
}

function AliasesTab({ kind }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: values = [], isLoading, error, refetch } = useNameValues(kind)
  const [selected, setSelected] = useState(() => new Set())
  const [canonical, setCanonical] = useState('')
  const [search, setSearch] = useState('')
  const [onlyWithoutRule, setOnlyWithoutRule] = useState(false)
  const [busy, setBusy] = useState(false)

  const byRaw = useMemo(() => new Map(values.map((v) => [v.raw_value, v])), [values])

  const visible = useMemo(() => {
    const q = normalizeText(search)
    return values.filter((v) => {
      if (onlyWithoutRule && v.alias) return false
      if (q && !normalizeText(`${v.raw_value} ${v.alias?.canonical_value || ''}`).includes(q)) return false
      return true
    })
  }, [values, search, onlyWithoutRule])

  // Návrhy: varianty, ktoré sa líšia len diakritikou / veľkosťou písmen / medzerami
  // a ešte nie sú zjednotené pod jeden názov.
  const groups = useMemo(
    () =>
      groupNameVariants(values.filter((v) => !v.alias?.is_excluded)).filter((g) => {
        const targets = new Set(g.map((v) => v.alias?.canonical_value || v.raw_value))
        return targets.size > 1
      }),
    [values],
  )

  const canonicalOptions = useMemo(() => {
    const set = new Set()
    for (const v of values) {
      if (v.alias?.canonical_value) set.add(v.alias.canonical_value)
      else if (!v.alias) set.add(v.raw_value)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'sk'))
  }, [values])

  function toggle(raw) {
    const next = new Set(selected)
    if (next.has(raw)) next.delete(raw)
    else next.add(raw)
    setSelected(next)
    if (next.size === 0) setCanonical('')
    else if (!canonical) {
      const top = [...next].map((r) => byRaw.get(r)).sort((a, b) => b.occurrences - a.occurrences)[0]
      setCanonical(top?.alias?.canonical_value || top?.raw_value || '')
    }
  }

  // Zmeny sa naplánujú (pravidlá ostávajú ploché, A→C), uložia sa atomicky
  // a ponúkne sa krok späť, ktorý vráti presne predchádzajúci stav.
  async function run(changes, message) {
    if (changes.length === 0) {
      toast.show({ message: 'Nie je čo meniť — pravidlá už zodpovedajú.' })
      return
    }
    setBusy(true)
    try {
      await applyAliasChanges(kind, changes)
      setSelected(new Set())
      setCanonical('')
      toast.show({ message, tone: 'success', action: { label: 'Späť', onClick: () => undo(changes) } })
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
      queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY })
    }
  }

  async function undo(changes) {
    try {
      await applyAliasChanges(kind, invertChanges(changes))
      toast.show({ message: 'Zmena je vrátená.' })
    } catch (err) {
      toast.error(err)
    } finally {
      queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY })
    }
  }

  function merge(raws, target) {
    let changes
    try {
      changes = planMerge(values, raws, target)
    } catch (err) {
      toast.error(err)
      return
    }
    const finalName = changes.find((c) => c.rule?.canonical_value)?.rule.canonical_value || target
    const chained = changes.filter((c) => !raws.includes(c.raw_value)).length
    run(
      changes,
      `Zlúčené pod „${finalName}" (${countLabel(changes.length, 'zmena', 'zmeny', 'zmien')}${chained ? `, z toho ${chained} presmerovaných variantov` : ''}).`,
    )
  }

  function exclude(raws) {
    const variants = variantsOf(values, raws).filter((r) => !raws.includes(r))
    let withVariants = false
    if (variants.length > 0) {
      withVariants = window.confirm(
        `Pod vyradenými hodnotami sú zlúčené ďalšie varianty (${variants.length}): ${variants.slice(0, 8).join(', ')}${variants.length > 8 ? '…' : ''}.\n\nVyradiť aj tieto varianty? (Zrušiť = vyradiť len vybrané hodnoty.)`,
      )
    }
    const changes = planExclude(values, raws, { withVariants })
    run(changes, `Vyradené: ${countLabel(changes.length, 'hodnota', 'hodnoty', 'hodnôt')}.`)
  }

  function clear(raws) {
    run(planClear(values, raws), 'Pravidlá sú zrušené — hodnoty sú v pôvodnom stave.')
  }

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} onRetry={refetch} />
  if (values.length === 0) return <EmptyState title="Archív zatiaľ neobsahuje žiadne hodnoty." />

  const selectedList = [...selected]
  const label = ALIAS_KIND_LABELS[kind].toLowerCase()

  return (
    <div className="flex flex-col gap-4">
      {groups.length > 0 && (
        <Card className="p-3">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">Návrhy na zlúčenie</h2>
          <ul className="flex flex-col gap-2">
            {groups.slice(0, 20).map((g) => {
              const sorted = g.slice().sort((a, b) => b.occurrences - a.occurrences)
              const target = sorted[0].alias?.canonical_value || sorted[0].raw_value
              return (
                <li key={g[0].raw_value} className="flex flex-wrap items-center gap-2 text-sm">
                  {sorted.map((v) => (
                    <Badge key={v.raw_value}>
                      {v.raw_value} · {v.occurrences}
                    </Badge>
                  ))}
                  <Button size="sm" disabled={busy} onClick={() => merge(sorted.map((v) => v.raw_value), target)}>
                    Zlúčiť ako „{target}"
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder={`Hľadať v hodnotách (${label})…`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Hľadať" />
          <Checkbox label="Len bez pravidla" checked={onlyWithoutRule} onChange={(e) => setOnlyWithoutRule(e.target.checked)} />
          <span className="ml-auto text-sm text-stone-500">{countLabel(values.length, 'rôzna hodnota', 'rôzne hodnoty', 'rôznych hodnôt')}</span>
        </div>
        {/* Prázdna hodnota zámerne nemá pravidlo: zlúčiť ju pod názov by vymyslelo údaj, ktorý v súpiske
            nebol, a hromadne ju vyradiť by z filmografie a leaderboardu zmazalo skutočné nakrúcacie dni. */}
        <p className="text-xs text-stone-500">
          Záznamy bez vyplnenej hodnoty sa tu nezobrazujú a pravidlo pre ne nastaviť nemožno — človek na pľaci bol, len
          chýba údaj. Chybný záznam vyraďte jednotlivo v Archíve (filter Postavy → „(bez postavy)").
        </p>

        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-stone-100 p-3">
            <span className="self-center text-sm font-medium">Vybrané: {selectedList.length}</span>
            <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-stone-600">
              Spoločný názov
              <Input list={`canonical-${kind}`} value={canonical} onChange={(e) => setCanonical(e.target.value)} />
              <datalist id={`canonical-${kind}`}>
                {canonicalOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>
            <Button variant="primary" disabled={busy || !canonical.trim()} onClick={() => merge(selectedList, canonical.trim())}>
              Zlúčiť pod tento názov
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => exclude(selectedList)}>
              Vyradiť
            </Button>
            <Button disabled={busy || !selectedList.some((r) => byRaw.get(r)?.alias)} onClick={() => clear(selectedList)}>
              Zrušiť pravidlá
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Zrušiť výber
            </Button>
          </div>
        )}

        <div className="max-h-[60vh] overflow-auto rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <span className="sr-only">Vybrať</span>
                </th>
                <th className="px-3 py-2">Pôvodná hodnota</th>
                <th className="px-3 py-2 text-right">Výskyty</th>
                <th className="px-3 py-2">Pravidlo</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Akcie</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visible.map((v) => (
                <tr key={v.raw_value} className={selected.has(v.raw_value) ? 'bg-sky-50' : ''}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-stone-900"
                      checked={selected.has(v.raw_value)}
                      onChange={() => toggle(v.raw_value)}
                      aria-label={`Vybrať ${v.raw_value}`}
                    />
                  </td>
                  <td className="px-3 py-1.5 font-medium">
                    {v.raw_value.trim() === '' ? <span className="italic text-stone-400">(prázdne)</span> : v.raw_value}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{v.occurrences}</td>
                  <td className="px-3 py-1.5">{ruleLabel(v.alias) || <span className="text-stone-400">—</span>}</td>
                  <td className="px-3 py-1.5 text-right">
                    {v.alias && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => clear([v.raw_value])}>
                        Zrušiť pravidlo
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="px-3 py-4 text-sm text-stone-500">Nič nezodpovedá hľadaniu.</p>}
        </div>
      </Card>
    </div>
  )
}
