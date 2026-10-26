import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSelection, subscribeSelection } from '../../api/selections.js'
import { usePermissions } from '../../auth/AuthContext.js'
import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { Badge, Button, Checkbox, EmptyState, ErrorMessage, Input, PageHeader, Spinner } from '../../components/ui.jsx'
import { cx } from '../../lib/cx.js'
import { normalizeText } from '../../lib/format.js'
import { ExportDialog } from '../exports/ExportDialog.jsx'
import { neutralizeFormula } from '../exports/exportFiles.js'
import { COLUMNS, TABLE_VIEWS, allowedColumns, cellText, compareRows, isMissing } from './columns.js'
import { useSelectionRows } from './useSelectionRows.js'
import { selectionKey, useOpenSelectionInCart } from './useSaveSelection.js'

const CURRENT = 'aktualny'
const COLS_STORAGE_KEY = 'komparz-selection-columns-v1'

function readColumnPrefs() {
  try {
    return JSON.parse(localStorage.getItem(COLS_STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

export function SelectionDetailPage() {
  const { selectionId } = useParams()
  const isCurrent = selectionId === CURRENT
  const current = useCurrentSelection()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: selectionKey(selectionId),
    queryFn: () => getSelection(selectionId),
    enabled: !isCurrent,
  })

  useEffect(() => {
    if (isCurrent) return undefined
    return subscribeSelection(selectionId, () => queryClient.invalidateQueries({ queryKey: selectionKey(selectionId) }))
  }, [isCurrent, selectionId, queryClient])

  const items = useMemo(() => {
    if (isCurrent) return current.items
    return (query.data?.items || []).map((i) => ({ personId: i.person_id, note: i.note || '' }))
  }, [isCurrent, current.items, query.data])

  const meta = isCurrent
    ? { name: current.loaded?.name || 'Aktuálny výber (neuložený)', project_name: current.loaded?.project_name || '', subtitle: current.loaded?.subtitle || '' }
    : query.data?.selection

  if (!isCurrent && query.isLoading) return <Spinner />
  if (!isCurrent && query.error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorMessage error={query.error} onRetry={query.refetch} />
        <Link to="/vybery" className="text-sm underline">
          Späť na výbery
        </Link>
      </div>
    )
  }

  return <SelectionTable key={selectionId} items={items} meta={meta} isCurrent={isCurrent} selectionId={isCurrent ? null : Number(selectionId)} />
}

function SelectionTable({ items, meta, isCurrent, selectionId }) {
  const { canSeeContacts, canExport } = usePermissions()
  const openProfile = useOpenProfile()
  const openInCart = useOpenSelectionInCart()
  const views = TABLE_VIEWS.filter((v) => canSeeContacts || !v.contact)
  const [viewKey, setViewKey] = useState(views[0].key)
  const [columnPrefs, setColumnPrefs] = useState(readColumnPrefs)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [checked, setChecked] = useState(() => new Set())
  const [showColumns, setShowColumns] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const view = views.find((v) => v.key === viewKey) || views[0]
  const columns = allowedColumns(columnPrefs[view.key] || view.columns, canSeeContacts)
  const needsStats = columns.some((k) => COLUMNS[k].stats)
  const { rows, isLoading, contactsLoading, statsLoading, statsError, contactsError, missingPeople } = useSelectionRows(items, {
    withContacts: canSeeContacts,
    withStats: needsStats || exportOpen,
  })

  function setColumns(next) {
    const prefs = { ...columnPrefs, [view.key]: next }
    setColumnPrefs(prefs)
    try {
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // nič
    }
  }

  function toggleColumn(key) {
    if (columns.includes(key)) setColumns(columns.filter((k) => k !== key))
    else setColumns([...columns, key])
  }

  // Výbery majú desiatky až stovky ľudí — prepočet pri každom vykreslení je lacný.
  const q = normalizeText(search)
  let visibleRows = q ? rows.filter((r) => normalizeText(columns.map((k) => cellText(k, r)).join(' ')).includes(q)) : rows
  if (sort.key && COLUMNS[sort.key]) visibleRows = [...visibleRows].sort(compareRows(sort.key, sort.dir))
  // Kým sa kontakty alebo štatistiky načítavajú, ich prázdne hodnoty nepočítame ako chýbajúce.
  const checkableColumns = columns.filter((k) => !(COLUMNS[k].contact && contactsLoading) && !(COLUMNS[k].stats && statsLoading))
  const missingCount = visibleRows.reduce((n, r) => n + (checkableColumns.some((k) => isMissing(k, r)) ? 1 : 0), 0)

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function toggleRow(id) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => checked.has(r.id))
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(visibleRows.map((r) => r.id)))
  }

  const exportRows = checked.size ? visibleRows.filter((r) => checked.has(r.id)) : visibleRows

  async function copyTable() {
    const header = columns.map((k) => COLUMNS[k].label).join('\t')
    const body = exportRows.map((r) => columns.map((k) => neutralizeFormula(cellText(k, r).replace(/\s+/g, ' '))).join('\t'))
    await navigator.clipboard.writeText([header, ...body].join('\n'))
  }

  return (
    <div>
      <PageHeader
        title={meta?.name || 'Výber'}
        subtitle={
          <>
            {[meta?.project_name, meta?.subtitle].filter(Boolean).join(' — ')}
            {meta?.author_name && <span className="ml-1 text-stone-400">· autor {meta.author_name}</span>}
          </>
        }
        actions={
          <>
            <Link to="/vybery" className="text-sm text-stone-600 underline">
              Všetky výbery
            </Link>
            {!isCurrent && (
              <Button onClick={() => openInCart(selectionId)}>Otvoriť do košíka</Button>
            )}
            {canExport && (
              <Button variant="primary" onClick={() => setExportOpen(true)} disabled={rows.length === 0}>
                Exportovať{checked.size ? ` (${checked.size})` : ''}
              </Button>
            )}
          </>
        }
      />

      {isCurrent && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Pracujete s aktuálnym výberom z košíka{rows.length ? '' : ' — je prázdny'}. Poznámky upravíte v košíku dole.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5" role="tablist" aria-label="Pohľad na tabuľku">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === view.key}
              onClick={() => setViewKey(v.key)}
              className={cx('rounded-md px-3 py-1.5 text-sm font-medium', v.key === view.key ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Input type="search" placeholder="Hľadať v tabuľke…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Button size="sm" variant="ghost" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
          Stĺpce ▾
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setColumns(view.columns)}>
          Predvolené stĺpce
        </Button>
        {canExport && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copyTable().catch(() => {})}
            disabled={exportRows.length === 0 || (contactsLoading && columns.some((k) => COLUMNS[k].contact)) || (statsLoading && needsStats)}
          >
            Kopírovať tabuľku
          </Button>
        )}
        <span className="ml-auto text-sm text-stone-500">
          {visibleRows.length} {visibleRows.length === 1 ? 'osoba' : 'osôb'}
          {checked.size > 0 && ` · označených ${checked.size}`}
          {missingCount > 0 && <Badge tone="danger" className="ml-2">{missingCount} s chýbajúcimi údajmi</Badge>}
        </span>
      </div>

      {showColumns && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white p-3">
          {allowedColumns(Object.keys(COLUMNS), canSeeContacts).map((k) => (
            <Checkbox key={k} label={COLUMNS[k].label} checked={columns.includes(k)} onChange={() => toggleColumn(k)} />
          ))}
        </div>
      )}

      <ErrorMessage error={contactsError} />
      {statsError && needsStats && <ErrorMessage error={statsError} />}
      {missingPeople > 0 && (
        <p className="mb-2 text-sm text-amber-800">{missingPeople} profil(ov) z výberu nie je dostupných (neaktívne alebo anonymizované).</p>
      )}

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title="Výber je prázdny" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Označiť všetky" className="accent-stone-900" />
                </th>
                {columns.map((k) => (
                  <th key={k} className="px-3 py-2" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 font-semibold hover:text-stone-900">
                      {COLUMNS[k].label}
                      {sort.key === k && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visibleRows.map((r) => (
                <tr key={r.id} className={cx('hover:bg-stone-50', checked.has(r.id) && 'bg-sky-50')}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Označiť ${r.name}`} className="accent-stone-900" />
                  </td>
                  {columns.map((k) => (
                    <td key={k} className={cx('px-3 py-2 align-top', COLUMNS[k].numeric && 'tabular-nums')}>
                      <Cell colKey={k} row={r} loading={(COLUMNS[k].contact && contactsLoading) || (COLUMNS[k].stats && statsLoading)} onOpen={() => openProfile(r.id)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          rows={exportRows}
          tableColumns={columns}
          viewLabel={view.label}
          meta={meta}
          contactsLoading={contactsLoading}
          contactsError={contactsError}
          statsLoading={statsLoading}
          statsError={statsError}
        />
      )}
    </div>
  )
}

function Cell({ colKey, row, loading, onOpen }) {
  if (colKey === 'name') {
    return (
      <button type="button" onClick={onOpen} className="font-medium text-stone-900 hover:underline">
        {row.name}
      </button>
    )
  }
  if (loading) return <span className="text-stone-300">…</span>
  if (isMissing(colKey, row)) return <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">chýba</span>
  const text = cellText(colKey, row)
  if (colKey === 'phone' && text) {
    return (
      <a href={`tel:${text.replace(/\s+/g, '')}`} className="text-sky-800 underline">
        {text}
      </a>
    )
  }
  if (colKey === 'email' && text) {
    return (
      <a href={`mailto:${text}`} className="text-sky-800 underline">
        {text}
      </a>
    )
  }
  return <span className={cx(colKey === 'note' || colKey === 'person_notes' ? 'block max-w-xs whitespace-pre-wrap' : '')}>{text}</span>
}
