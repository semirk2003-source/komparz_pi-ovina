import { useDeferredValue, useMemo, useState } from 'react'
import { usePeopleList } from '../../hooks/usePeopleList.js'
import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { usePermissions } from '../../auth/AuthContext.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { Button, Chip, EmptyState, ErrorMessage, Input, PageHeader, Select, Spinner } from '../../components/ui.jsx'
import { countLabel } from '../../lib/format.js'
import {
  SORTS, applyPredicates, baseTest, buildPredicates, buildSearchIndex, computeStats,
  hasActiveFilters, relaxationCounts, sortPeople, EMPTY_FILTERS,
} from './peopleFilters.js'
import { useFilters, useRegistrations } from './hooks.js'
import { FiltersPanel, QuickFilters } from './FiltersPanel.jsx'
import { PeopleGrid } from './PeopleGrid.jsx'
import { CreatePersonDialog } from './PersonForm.jsx'

const BULK_CONFIRM = 50

/**
 * Spoločné zobrazenie zoznamu ľudí s vyhľadávaním, filtrami a štatistikami.
 * restrictIds: Set id profilov (napr. obľúbení) alebo null = všetci.
 */
export function PeopleBrowser({ title, subtitle, restrictIds = null, emptyTitle, emptyText }) {
  const { people, isLoading, error, refetch } = usePeopleList()
  const waves = useRegistrations()
  const { filters, setFilters, lastKey } = useFilters()
  const selection = useCurrentSelection()
  const { canEdit } = usePermissions()
  const toast = useToast()
  const [showFilters, setShowFilters] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [creating, setCreating] = useState(false)

  const scoped = useMemo(
    () => (restrictIds ? people.filter((p) => restrictIds.has(p.id)) : people),
    [people, restrictIds],
  )
  const index = useMemo(() => buildSearchIndex(scoped), [scoped])

  // Text vyhľadávania filtrujeme s odloženou prioritou, aby písanie nesekalo.
  const deferredQ = useDeferredValue(filters.q)
  const effective = useMemo(() => ({ ...filters, q: deferredQ }), [filters, deferredQ])

  const predicates = useMemo(() => buildPredicates(effective, { waves }), [effective, waves])
  const base = useMemo(() => baseTest(effective), [effective])
  const results = useMemo(
    () => sortPeople(applyPredicates(index, base, predicates), effective.sort),
    [index, base, predicates, effective.sort],
  )
  const stats = useMemo(() => computeStats(results), [results])

  const relaxations = useMemo(
    () => (results.length === 0 && predicates.length > 0 ? relaxationCounts(index, base, predicates) : []),
    [results.length, predicates, index, base],
  )

  const selectedInView = useMemo(() => results.reduce((n, p) => n + (selection.has(p.id) ? 1 : 0), 0), [results, selection])

  function addAllShown() {
    if (results.length === 0) return
    if (results.length > BULK_CONFIRM && !window.confirm(`Pridať do výberu všetkých ${results.length} zobrazených ľudí?`)) return
    selection.add(results.map((p) => p.id))
    toast.show({
      message: `Do výberu pridaných: ${results.length - selectedInView}.`,
      action: { label: 'Späť', onClick: selection.undo },
    })
  }

  const filtersActive = hasActiveFilters(filters)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {canEdit && results.length > 0 && (
              <Button onClick={addAllShown}>Pridať zobrazených do výberu</Button>
            )}
            {canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Nový profil
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Hľadať meno, mesto, poznámku…"
            aria-label="Vyhľadávanie"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value }, 'q')}
            className="min-w-56 flex-1"
          />
          <Select
            aria-label="Zoradenie"
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value })}
            options={SORTS}
            className="w-auto"
          />
          <Button onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            {showFilters ? 'Skryť filtre' : 'Filtre'}
          </Button>
        </div>
        <QuickFilters filters={filters} setFilters={setFilters} />
        {showFilters && <FiltersPanel filters={filters} setFilters={setFilters} waves={waves} />}

        {(filtersActive || filters.inactive) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {buildPredicates(filters, { waves }).map((p) => (
              <Chip key={p.key} onRemove={() => setFilters((f) => p.clear(f))}>
                {p.label}
              </Chip>
            ))}
            {filters.inactive && <Chip onRemove={() => setFilters({ inactive: false })}>Vrátane neaktívnych</Chip>}
            <button
              type="button"
              className="ml-1 text-xs text-stone-500 underline hover:text-stone-900"
              onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}
            >
              Zrušiť všetky filtre
            </button>
          </div>
        )}
      </div>

      {!isLoading && !error && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="V zobrazení" value={stats.count.toLocaleString('sk-SK')} />
          <Stat label="Priemerný vek" value={stats.avgAge != null ? stats.avgAge.toLocaleString('sk-SK') : '—'} />
          <Stat label="Z Bratislavy" value={stats.bratislava.toLocaleString('sk-SK')} />
          <Stat label="Vo výbere" value={`${selection.count}${selectedInView ? ` (${selectedInView} tu)` : ''}`} />
        </dl>
      )}

      {isLoading && <Spinner label="Načítavam profily…" />}
      <ErrorMessage error={error} onRetry={refetch} />

      {!isLoading && !error && results.length === 0 && (
        <NoResults
          scopedEmpty={scoped.length === 0}
          emptyTitle={emptyTitle}
          emptyText={emptyText}
          relaxations={relaxations}
          lastKey={lastKey}
          onRelax={(p) => setFilters((f) => p.clear(f))}
          onReset={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}
        />
      )}

      {!isLoading && results.length > 0 && <PeopleGrid people={results} />}

      {creating && <CreatePersonDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-stone-900">{value}</dd>
    </div>
  )
}

// Prázdny výsledok: povie, ktorý filter je najužší, a ponúkne jeho uvoľnenie.
function NoResults({ scopedEmpty, emptyTitle, emptyText, relaxations, lastKey, onRelax, onReset }) {
  if (scopedEmpty) {
    return <EmptyState title={emptyTitle || 'Zatiaľ tu nie sú žiadne profily.'}>{emptyText}</EmptyState>
  }
  if (relaxations.length === 0) {
    return (
      <EmptyState title="Žiadny aktívny profil nevyhovuje." action={<Button onClick={onReset}>Zobraziť všetkých</Button>}>
        Skúste zapnúť „Zobraziť aj neaktívne profily".
      </EmptyState>
    )
  }
  const narrowest = relaxations.reduce((best, r) => (r.count > best.count ? r : best), relaxations[0])
  const last = relaxations.find((r) => r.predicate.key === lastKey) || relaxations[relaxations.length - 1]

  return (
    <EmptyState
      title="Týmto filtrom nevyhovuje nikto."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {last && (
            <Button variant="primary" onClick={() => onRelax(last.predicate)}>
              Uvoľniť posledný filter ({last.predicate.label}) → {countLabel(last.count, 'profil', 'profily', 'profilov')}
            </Button>
          )}
          {narrowest && narrowest !== last && narrowest.count > 0 && (
            <Button onClick={() => onRelax(narrowest.predicate)}>
              Uvoľniť najužší ({narrowest.predicate.label}) → {countLabel(narrowest.count, 'profil', 'profily', 'profilov')}
            </Button>
          )}
          <Button variant="ghost" onClick={onReset}>
            Zrušiť všetky filtre
          </Button>
        </div>
      }
    >
      {narrowest.count > 0 ? (
        <>
          Najužší je filter <strong>{narrowest.predicate.label}</strong> — bez neho by vyhovovalo{' '}
          {countLabel(narrowest.count, 'profil', 'profily', 'profilov')}.
        </>
      ) : (
        <>Ani uvoľnenie jedného filtra nepomôže — kombinácia je príliš úzka. Skúste zrušiť viac filtrov naraz.</>
      )}
    </EmptyState>
  )
}
