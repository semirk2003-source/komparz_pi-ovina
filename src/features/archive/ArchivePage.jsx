import { memo, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  PageHeader, Button, Input, Select, Checkbox, Badge, Chip, Spinner, ErrorMessage, EmptyState, Card,
} from '../../components/ui.jsx'
import { usePermissions } from '../../auth/AuthContext.js'
import { usePeopleList } from '../../hooks/usePeopleList.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { MATCH_STATUS, MATCH_STATUS_LABELS } from '../../constants/polia.js'
import { formatDate, nameWithId, normalizeText, countLabel } from '../../lib/format.js'
import { countNamesakes } from '../../lib/nameMatch.js'
import {
  confirmSuggestion, unlinkAppearance, setExcluded, linkAppearance, suggestAppearance,
} from '../../api/archive.js'
import { useAppearances, useArchiveFacets, useArchiveMutation } from './archiveQueries.js'
import { STATUS_TONE } from './archiveUtils.js'
import { MultiSelect } from './MultiSelect.jsx'
import { LinkModal } from './LinkModal.jsx'
import { EditAppearanceModal } from './EditAppearanceModal.jsx'
import { AddAppearancesModal } from './AddAppearancesModal.jsx'

const SK_COLLATOR = new Intl.Collator('sk')

const EMPTY_FILTERS = {
  search: '',
  production: '',
  roles: [],
  dateFrom: '',
  dateTo: '',
  status: '',
  showExcluded: false,
}

const GRID = 'grid grid-cols-[96px_minmax(200px,1.6fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(90px,0.7fr)_minmax(230px,1.3fr)_88px] items-center gap-3'

export function ArchivePage() {
  const permissions = usePermissions()
  const { data: rows = [], isLoading, error, refetch } = useAppearances()
  const { people, byId } = usePeopleList()
  const { data: facets = [] } = useArchiveFacets()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState('date-desc')
  const [linking, setLinking] = useState(null)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const deferredSearch = useDeferredValue(filters.search)

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }))

  // Text na vyhľadávanie — pôvodné aj opravené meno, prepojený profil, postava, projekt, séria.
  const searchIndex = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const person = r.person_id != null ? byId.get(r.person_id) : null
      map.set(
        r.id,
        normalizeText(
          [r.raw_name, r.name_override, person && `${person.first_name} ${person.last_name} ${person.id}`, r.role_effective, r.production_effective, r.series_effective].join(' '),
        ),
      )
    }
    return map
  }, [rows, byId])

  const roleOptions = useMemo(() => {
    const counts = new Map()
    for (const r of rows) {
      if (!filters.showExcluded && r.excluded_effective) continue
      const v = r.role_effective || '(bez postavy)'
      counts.set(v, (counts.get(v) || 0) + 1)
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [rows, filters.showExcluded])

  const productionOptions = useMemo(() => facets.map((f) => f.production), [facets])

  // Filtre bez stavu prepojenia — kvôli počtom na rýchlych filtroch.
  // Závislosti po jednotlivých poliach: písanie do hľadania (filters.search) nesmie
  // prepočítavať zoznam okamžite, len cez odložené deferredSearch.
  const { showExcluded, production, roles: roleFilter, dateFrom, dateTo, status } = filters
  const baseFiltered = useMemo(() => {
    const q = normalizeText(deferredSearch)
    const roles = roleFilter.length ? new Set(roleFilter) : null
    return rows.filter((r) => {
      if (!showExcluded && r.excluded_effective) return false
      if (production && r.production_effective !== production) return false
      if (roles && !roles.has(r.role_effective || '(bez postavy)')) return false
      if (dateFrom && r.shoot_date < dateFrom) return false
      if (dateTo && r.shoot_date > dateTo) return false
      if (q && !searchIndex.get(r.id)?.includes(q)) return false
      return true
    })
  }, [rows, showExcluded, production, roleFilter, dateFrom, dateTo, deferredSearch, searchIndex])

  const statusCounts = useMemo(() => {
    const c = { [MATCH_STATUS.UNMATCHED]: 0, [MATCH_STATUS.SUGGESTED]: 0, [MATCH_STATUS.CONFIRMED]: 0 }
    for (const r of baseFiltered) c[r.match_status]++
    return c
  }, [baseFiltered])

  const filtered = useMemo(() => {
    const list = status ? baseFiltered.filter((r) => r.match_status === status) : baseFiltered.slice()
    if (sort === 'date-asc') list.sort((a, b) => (a.shoot_date > b.shoot_date ? 1 : a.shoot_date < b.shoot_date ? -1 : a.id - b.id))
    else if (sort === 'name') list.sort((a, b) => SK_COLLATOR.compare(a.display_name, b.display_name) || (a.shoot_date < b.shoot_date ? 1 : -1))
    else list.sort((a, b) => (a.shoot_date < b.shoot_date ? 1 : a.shoot_date > b.shoot_date ? -1 : b.id - a.id))
    return list
  }, [baseFiltered, status, sort])

  const summary = useMemo(() => {
    let min = null
    let max = null
    let linked = 0
    const persons = new Set()
    const unlinkedNames = new Set()
    for (const r of filtered) {
      if (!min || r.shoot_date < min) min = r.shoot_date
      if (!max || r.shoot_date > max) max = r.shoot_date
      if (r.match_status === MATCH_STATUS.CONFIRMED) {
        linked++
        persons.add(r.person_id)
      } else {
        unlinkedNames.add(normalizeText(r.display_name))
      }
    }
    return { min, max, linked, persons: persons.size, unlinkedNames: unlinkedNames.size }
  }, [filtered])

  const activeChips = []
  if (filters.search) activeChips.push({ key: 'search', label: `Hľadať: ${filters.search}`, clear: () => set('search', '') })
  if (filters.production) activeChips.push({ key: 'production', label: `Projekt: ${filters.production}`, clear: () => set('production', '') })
  for (const role of filters.roles) {
    activeChips.push({ key: `role-${role}`, label: `Postava: ${role}`, clear: () => set('roles', filters.roles.filter((r) => r !== role)) })
  }
  if (filters.dateFrom) activeChips.push({ key: 'from', label: `Od ${formatDate(filters.dateFrom)}`, clear: () => set('dateFrom', '') })
  if (filters.dateTo) activeChips.push({ key: 'to', label: `Do ${formatDate(filters.dateTo)}`, clear: () => set('dateTo', '') })
  if (filters.status) activeChips.push({ key: 'status', label: MATCH_STATUS_LABELS[filters.status], clear: () => set('status', '') })
  if (filters.showExcluded) activeChips.push({ key: 'excl', label: 'Vrátane vyradených', clear: () => set('showExcluded', false) })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Archív účinkovania"
        subtitle="Kto, kedy, akú postavu a v čom hral. Do filmografie a leaderboardu idú len potvrdené záznamy."
        actions={
          permissions.canEdit && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Pridať záznamy
            </Button>
          )
        }
      />

      <Card className="flex flex-col gap-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1.2fr_auto_auto_1fr]">
          <Input placeholder="Hľadať meno, postavu, projekt…" value={filters.search} onChange={(e) => set('search', e.target.value)} aria-label="Hľadať v archíve" />
          <Select value={filters.production} onChange={(e) => set('production', e.target.value)} options={productionOptions} placeholder="Všetky projekty" aria-label="Projekt" />
          <MultiSelect label="Postavy" options={roleOptions} value={filters.roles} onChange={(v) => set('roles', v)} placeholder="Všetky postavy" />
          <Input type="date" value={filters.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} aria-label="Dátum od" title="Dátum od" />
          <Input type="date" value={filters.dateTo} onChange={(e) => set('dateTo', e.target.value)} aria-label="Dátum do" title="Dátum do" />
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Zoradenie"
            options={[
              { value: 'date-desc', label: 'Najnovšie' },
              { value: 'date-asc', label: 'Najstaršie' },
              { value: 'name', label: 'Podľa mena' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusButton active={!filters.status} onClick={() => set('status', '')}>
            Všetky <span className="text-stone-400">{baseFiltered.length}</span>
          </StatusButton>
          {[MATCH_STATUS.UNMATCHED, MATCH_STATUS.SUGGESTED, MATCH_STATUS.CONFIRMED].map((s) => (
            <StatusButton key={s} active={filters.status === s} onClick={() => set('status', filters.status === s ? '' : s)}>
              {MATCH_STATUS_LABELS[s]} <span className="text-stone-400">{statusCounts[s]}</span>
            </StatusButton>
          ))}
          <Checkbox className="ml-auto" label="Zobraziť vyradené" checked={filters.showExcluded} onChange={(e) => set('showExcluded', e.target.checked)} />
        </div>
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((c) => (
              <Chip key={c.key} onRemove={c.clear}>
                {c.label}
              </Chip>
            ))}
            <button type="button" className="text-xs text-stone-600 underline" onClick={() => setFilters(EMPTY_FILTERS)}>
              Zrušiť všetky filtre
            </button>
          </div>
        )}
      </Card>

      {!isLoading && !error && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Záznamov" value={filtered.length.toLocaleString('sk-SK')} />
          <Stat label="Obdobie" value={summary.min ? `${formatDate(summary.min)} – ${formatDate(summary.max)}` : '—'} />
          <Stat label="Potvrdené prepojenia" value={`${summary.linked.toLocaleString('sk-SK')} z ${filtered.length.toLocaleString('sk-SK')}`} />
          <Stat
            label="Týka sa osôb"
            value={summary.persons.toLocaleString('sk-SK')}
            hint={summary.unlinkedNames ? `+ ${countLabel(summary.unlinkedNames, 'meno', 'mená', 'mien')} bez profilu` : null}
          />
        </div>
      )}

      {isLoading && <Spinner label="Načítavam archív…" />}
      <ErrorMessage error={error} onRetry={refetch} />

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          title="Filtrom nezodpovedá žiadny záznam"
          action={
            activeChips.length > 0 && (
              <Button onClick={() => activeChips[activeChips.length - 1].clear()}>Uvoľniť posledný filter</Button>
            )
          }
        >
          {activeChips.length > 0 ? `Posledný filter: ${activeChips[activeChips.length - 1].label}.` : 'Archív je zatiaľ prázdny.'}
        </EmptyState>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <ArchiveTable
          rows={filtered}
          people={people}
          byId={byId}
          canEdit={permissions.canEdit}
          onLink={setLinking}
          onEdit={setEditing}
        />
      )}

      {linking && <LinkModal appearance={linking} people={people} onClose={() => setLinking(null)} />}
      {editing && (
        <EditAppearanceModal
          key={editing.id}
          appearanceId={editing.id}
          suggestions={{
            role_name: roleOptions.map((o) => o.value),
            production_name: productionOptions,
            series_name: [...new Set(facets.flatMap((f) => f.series))],
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && <AddAppearancesModal people={people} facets={facets} onClose={() => setAdding(false)} />}
    </div>
  )
}

function StatusButton({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}
      aria-pressed={active}
      {...props}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, hint }) {
  return (
    <Card className="px-3 py-2">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-stone-900">{value}</div>
      {hint && <div className="text-xs text-stone-500">{hint}</div>}
    </Card>
  )
}

function ArchiveTable({ rows, people, byId, canEdit, onLink, onEdit }) {
  const parentRef = useRef(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer vracia nememoizovateľné funkcie; React Compiler v projekte nepoužívame a komponent nie je memoizovaný.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 12,
  })

  return (
    <Card className="overflow-hidden">
      <div ref={parentRef} className="h-[65vh] overflow-auto">
        <div className="min-w-[1100px]">
          <div className={`${GRID} sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-stone-500`}>
            <span>Dátum</span>
            <span>Osoba</span>
            <span>Postava</span>
            <span>Projekt</span>
            <span>Séria</span>
            <span>Prepojenie</span>
            <span className="sr-only">Akcie</span>
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <div
                  key={row.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}
                >
                  <ArchiveRow
                    row={row}
                    person={row.person_id != null ? byId.get(row.person_id) : null}
                    people={people}
                    canEdit={canEdit}
                    onLink={onLink}
                    onEdit={onEdit}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

const ArchiveRow = memo(function ArchiveRow({ row, person, people, canEdit, onLink, onEdit }) {
  const openProfile = useOpenProfile()
  const toast = useToast()
  const confirm = useArchiveMutation((id) => confirmSuggestion(id))
  const exclude = useArchiveMutation(({ id, excluded }) => setExcluded(id, excluded))
  const unlink = useArchiveMutation((id) => unlinkAppearance(id))
  const restoreLink = useArchiveMutation(({ id, personId, status, score }) =>
    status === MATCH_STATUS.CONFIRMED ? linkAppearance(id, personId) : suggestAppearance(id, personId, score),
  )

  function doUnlink(message) {
    const previous = { id: row.id, personId: row.person_id, status: row.match_status, score: row.match_score }
    unlink.mutate(row.id, {
      onSuccess: () =>
        toast.show({ message, action: { label: 'Späť', onClick: () => restoreLink.mutate(previous) } }),
    })
  }

  function doExclude(excluded) {
    exclude.mutate(
      { id: row.id, excluded },
      {
        onSuccess: () =>
          toast.show({
            message: excluded ? 'Záznam je vyradený.' : 'Záznam je obnovený.',
            action: { label: 'Späť', onClick: () => exclude.mutate({ id: row.id, excluded: !excluded }) },
          }),
      },
    )
  }

  const busy = confirm.isPending || unlink.isPending || exclude.isPending
  const namesakes = person && row.match_status === MATCH_STATUS.SUGGESTED ? countNamesakes(person, people) : 0
  const nameChanged = row.name_override && row.name_override !== row.raw_name

  return (
    <div className={`${GRID} min-h-[56px] border-b border-stone-100 px-3 py-2 text-sm ${row.excluded_effective ? 'bg-stone-50 text-stone-400' : ''}`}>
      <span className="tabular-nums">{formatDate(row.shoot_date)}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium" title={row.raw_name}>
          {row.display_name}
        </span>
        {nameChanged && <span className="block truncate text-xs text-stone-500">zo súpisky: {row.raw_name}</span>}
        {row.match_status === MATCH_STATUS.CONFIRMED && person && (
          <button type="button" onClick={() => openProfile(person.id)} className="block truncate text-xs text-sky-700 hover:underline">
            {nameWithId(person)}
          </button>
        )}
      </span>
      <span className="truncate" title={row.role_name || ''}>
        {row.role_effective || '—'}
      </span>
      <span className="truncate">{row.production_effective || '—'}</span>
      <span className="truncate text-stone-600">{row.series_effective || '—'}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[row.match_status]}>{MATCH_STATUS_LABELS[row.match_status]}</Badge>
        {row.excluded_effective && <Badge>vyradený</Badge>}
        {row.match_status === MATCH_STATUS.SUGGESTED && person && (
          <>
            <button type="button" onClick={() => openProfile(person.id)} className="max-w-full truncate text-xs text-sky-700 hover:underline" title="Otvoriť navrhnutý profil">
              {nameWithId(person)}
              {row.match_score != null && ` · ${Math.round(row.match_score * 100)} %`}
            </button>
            {namesakes > 1 && <Badge tone="warning">menovec ×{namesakes}</Badge>}
          </>
        )}
        {canEdit && !row.excluded_effective && (
          <span className="flex gap-1">
            {row.match_status === MATCH_STATUS.SUGGESTED && (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => confirm.mutate(row.id)}>
                  Potvrdiť
                </Button>
                <Button size="sm" disabled={busy} onClick={() => doUnlink('Návrh je zamietnutý.')}>
                  Zamietnuť
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onLink(row)}>
                  Iný…
                </Button>
              </>
            )}
            {row.match_status === MATCH_STATUS.UNMATCHED && (
              <Button size="sm" disabled={busy} onClick={() => onLink(row)}>
                Priradiť…
              </Button>
            )}
            {row.match_status === MATCH_STATUS.CONFIRMED && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => doUnlink('Prepojenie je zrušené.')}>
                Odpojiť
              </Button>
            )}
          </span>
        )}
      </span>
      <span className="flex justify-end gap-1">
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onEdit(row)} title="Opraviť záznam">
              Upraviť
            </Button>
            {row.is_excluded ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => doExclude(false)} title="Obnoviť záznam">
                ↺
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => doExclude(true)} title="Vyradiť záznam (nemaže sa)" aria-label="Vyradiť záznam">
                ✕
              </Button>
            )}
          </>
        )}
      </span>
    </div>
  )
})
