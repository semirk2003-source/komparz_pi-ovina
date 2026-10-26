import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { PageHeader, Input, Select, Spinner, ErrorMessage, EmptyState, Card, Button, Chip } from '../../components/ui.jsx'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { usePermissions } from '../../auth/AuthContext.js'
import { usePeopleList } from '../../hooks/usePeopleList.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { AGE_DECADES, GENDERS } from '../../constants/polia.js'
import { formatDate, fullName, normalizeText, formatAge } from '../../lib/format.js'
import { AddToSelectionButton } from '../selections/AddToSelectionButton.jsx'
import { useArchiveFacets, useLeaderboard } from './archiveQueries.js'

const PRESETS = [
  { key: 'most', label: 'Najviac účinkovaní', sort: { key: 'days', dir: 'desc' } },
  { key: 'least', label: 'Najmenej účinkovaní', sort: { key: 'days', dir: 'asc' } },
  { key: 'recent', label: 'Naposledy obsadení', sort: { key: 'last', dir: 'desc' } },
  { key: 'longest', label: 'Najdlhšie neobsadení', sort: { key: 'last', dir: 'asc' } },
]

const GRID = 'grid grid-cols-[56px_minmax(220px,2fr)_110px_90px_150px_minmax(160px,2fr)_120px] items-center gap-3'
const DAY_MS = 24 * 3600 * 1000

function compareDates(a, b) {
  // null (nikdy neobsadený) je „najstarší" dátum
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  return a < b ? -1 : 1
}

function sinceLabel(date) {
  if (!date) return 'nikdy'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS)
  if (days < 1) return 'dnes'
  if (days < 60) return `pred ${days} d.`
  if (days < 730) return `pred ${Math.floor(days / 30.44)} mes.`
  return `pred ${Math.floor(days / 365.25)} r.`
}

// UC-10: poradie podľa nakrúcacích dní — aj obrátene, kto je najdlhšie neobsadený.
export function LeaderboardPage() {
  const permissions = usePermissions()
  const { people, isLoading: peopleLoading, error: peopleError } = usePeopleList()
  const { data: facets = [] } = useArchiveFacets()
  const [production, setProduction] = useState('')
  const [series, setSeries] = useState('')
  const [gender, setGender] = useState('')
  const [decade, setDecade] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(PRESETS[0].sort)
  const deferredSearch = useDeferredValue(search)
  const { data: stats, isLoading, error, refetch } = useLeaderboard(production, series)

  const seriesOptions = facets.find((f) => f.production === production)?.series || []

  // Všetci aktívni ľudia vrátane tých, ktorí ešte nehrali.
  const rows = useMemo(() => {
    if (!stats) return []
    const byPerson = new Map(stats.map((s) => [s.person_id, s]))
    return people
      .filter((p) => p.is_active)
      .map((p) => {
        const s = byPerson.get(p.id)
        return {
          person: p,
          shootDays: s?.shootDays || 0,
          records: s?.records || 0,
          lastDate: s?.lastDate || null,
          series: s?.series || [],
        }
      })
  }, [people, stats])

  // Poradie podľa počtu nakrúcacích dní (rovnaký počet = rovnaké poradie).
  const ranks = useMemo(() => {
    const sorted = rows.map((r) => r.shootDays).sort((a, b) => b - a)
    const firstIndex = new Map()
    sorted.forEach((d, i) => {
      if (!firstIndex.has(d)) firstIndex.set(d, i + 1)
    })
    return firstIndex
  }, [rows])

  const filtered = useMemo(() => {
    const q = normalizeText(deferredSearch)
    const dec = AGE_DECADES.find((d) => d.key === decade)
    const list = rows.filter((r) => {
      const p = r.person
      if (gender && p.gender !== gender) return false
      if (dec && (p.age == null || p.age < dec.min || p.age > dec.max)) return false
      if (q && !normalizeText(`${p.first_name} ${p.last_name} ${p.city || ''} ${p.id}`).includes(q)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const primary = {
      days: (a, b) => a.shootDays - b.shootDays || compareDates(a.lastDate, b.lastDate),
      records: (a, b) => a.records - b.records || a.shootDays - b.shootDays,
      last: (a, b) => compareDates(a.lastDate, b.lastDate) || a.shootDays - b.shootDays,
    }[sort.key]
    list.sort(
      (a, b) =>
        primary(a, b) * dir ||
        // pri zhode: kto je dlhšie v databáze, je skôr na rade
        compareDates(a.person.created_at, b.person.created_at) ||
        a.person.id - b.person.id,
    )
    return list
  }, [rows, gender, decade, deferredSearch, sort])

  const chips = []
  if (production) chips.push({ key: 'p', label: `Projekt: ${production}`, clear: () => { setProduction(''); setSeries('') } })
  if (series) chips.push({ key: 's', label: `Séria: ${series}`, clear: () => setSeries('') })
  if (gender) chips.push({ key: 'g', label: gender, clear: () => setGender('') })
  if (decade) chips.push({ key: 'd', label: `Vek ${AGE_DECADES.find((d) => d.key === decade)?.label}`, clear: () => setDecade('') })
  if (search) chips.push({ key: 'q', label: `Hľadať: ${search}`, clear: () => setSearch('') })

  const loading = isLoading || peopleLoading
  const anyError = error || peopleError

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Leaderboard"
        subtitle="Poradie podľa unikátnych nakrúcacích dní (len potvrdené záznamy). Obrátené zoradenie ukáže, kto ešte nedostal príležitosť."
      />

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = p.sort.key === sort.key && p.sort.dir === sort.dir
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSort(p.sort)}
                className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Hľadať meno alebo mesto…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Hľadať" />
          <Select
            value={production}
            onChange={(e) => {
              setProduction(e.target.value)
              setSeries('')
            }}
            options={facets.map((f) => f.production)}
            placeholder="Všetky projekty"
            aria-label="Projekt"
          />
          <Select value={series} onChange={(e) => setSeries(e.target.value)} options={seriesOptions} placeholder="Všetky série" disabled={!production || seriesOptions.length === 0} aria-label="Séria" />
          <Select value={gender} onChange={(e) => setGender(e.target.value)} options={GENDERS} placeholder="Pohlavie" aria-label="Pohlavie" />
          <Select value={decade} onChange={(e) => setDecade(e.target.value)} options={AGE_DECADES.map((d) => ({ value: d.key, label: d.label }))} placeholder="Vek" aria-label="Vek" />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c.key} onRemove={c.clear}>
                {c.label}
              </Chip>
            ))}
          </div>
        )}
        {production && (
          <p className="text-xs text-stone-500">
            Počty sú len za vybraný projekt{series ? ' a sériu' : ''}. Ľudia s nulou v ňom ešte nehrali.
          </p>
        )}
      </Card>

      {loading && <Spinner label="Počítam poradie…" />}
      <ErrorMessage error={anyError} onRetry={refetch} />

      {!loading && !anyError && filtered.length === 0 && (
        <EmptyState
          title="Nikto nezodpovedá filtrom"
          action={chips.length > 0 && <Button onClick={() => chips[chips.length - 1].clear()}>Uvoľniť posledný filter</Button>}
        />
      )}

      {!loading && !anyError && filtered.length > 0 && (
        <LeaderboardTable rows={filtered} ranks={ranks} sort={sort} onSort={setSort} canSelect={permissions.canEdit} />
      )}
    </div>
  )
}

function SortHeader({ label, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey
  return (
    <button
      type="button"
      className={`text-left uppercase tracking-wide hover:text-stone-900 ${active ? 'text-stone-900' : ''} ${className || ''}`}
      onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
    >
      {label} {active ? (sort.dir === 'desc' ? '↓' : '↑') : ''}
    </button>
  )
}

function LeaderboardTable({ rows, ranks, sort, onSort, canSelect }) {
  const parentRef = useRef(null)
  const openProfile = useOpenProfile()
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer vracia nememoizovateľné funkcie; React Compiler v projekte nepoužívame a komponent nie je memoizovaný.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 10,
  })

  return (
    <Card className="overflow-hidden">
      <p className="border-b border-stone-200 px-3 py-2 text-sm text-stone-600">{rows.length.toLocaleString('sk-SK')} ľudí</p>
      <div ref={parentRef} className="h-[65vh] overflow-auto">
        <div className="min-w-[960px]">
          <div className={`${GRID} sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-500`}>
            <span className="uppercase tracking-wide">#</span>
            <span className="uppercase tracking-wide">Osoba</span>
            <SortHeader label="Nakr. dni" sortKey="days" sort={sort} onSort={onSort} />
            <SortHeader label="Záznamy" sortKey="records" sort={sort} onSort={onSort} />
            <SortHeader label="Naposledy" sortKey="last" sort={sort} onSort={onSort} />
            <span className="uppercase tracking-wide">Seriály</span>
            <span className="sr-only">Výber</span>
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index]
              const p = r.person
              return (
                <div
                  key={p.id}
                  className={`${GRID} border-b border-stone-100 px-3 text-sm`}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <span className="tabular-nums text-stone-500">{ranks.get(r.shootDays)}.</span>
                  <button type="button" onClick={() => openProfile(p.id)} className="flex min-w-0 items-center gap-3 text-left">
                    <PersonPhoto path={p.thumb_path} alt="" className="h-12 w-9 shrink-0 rounded" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900 hover:underline">{fullName(p)}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {[formatAge(p.age), p.city, `[${p.id}]`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  <span className="font-semibold tabular-nums">{r.shootDays}</span>
                  <span className="tabular-nums text-stone-600">{r.records}</span>
                  <span className="leading-tight">
                    <span className="block tabular-nums">{r.lastDate ? formatDate(r.lastDate) : '—'}</span>
                    <span className="block text-xs text-stone-500">
                      {r.lastDate ? sinceLabel(r.lastDate) : `nikdy · v databáze od ${formatDate(p.created_at)}`}
                    </span>
                  </span>
                  <span className="truncate text-xs text-stone-600" title={r.series.join(', ')}>
                    {r.series.join(', ') || '—'}
                  </span>
                  <span className="flex justify-end">
                    {canSelect && <AddToSelectionButton personId={p.id} className="px-2.5 py-1 text-xs" />}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}
