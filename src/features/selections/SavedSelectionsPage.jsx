import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteSelection, listSelections, subscribeSelections, updateSelectionMeta } from '../../api/selections.js'
import { useAuth } from '../../auth/AuthContext.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { Badge, Button, Card, EmptyState, ErrorMessage, Input, PageHeader, Spinner } from '../../components/ui.jsx'
import { formatDateTime, normalizeText } from '../../lib/format.js'
import { SaveSelectionDialog } from './SaveSelectionDialog.jsx'
import { SELECTIONS_KEY, useOpenSelectionInCart } from './useSaveSelection.js'

export function SavedSelectionsPage() {
  const { user, permissions } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const current = useCurrentSelection()
  const openInCart = useOpenSelectionInCart()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const query = useQuery({ queryKey: SELECTIONS_KEY, queryFn: listSelections })

  // Zmeny od kolegov sa objavia bez obnovenia stránky.
  useEffect(
    () => subscribeSelections(null, () => queryClient.invalidateQueries({ queryKey: SELECTIONS_KEY })),
    [queryClient],
  )

  const list = useMemo(() => {
    const q = normalizeText(search)
    const rows = query.data || []
    if (!q) return rows
    return rows.filter((s) => normalizeText([s.name, s.project_name, s.subtitle, s.author_name].join(' ')).includes(q))
  }, [query.data, search])

  async function onSaveMeta(meta) {
    setBusy(true)
    try {
      await updateSelectionMeta(editing.id, meta)
      queryClient.invalidateQueries({ queryKey: SELECTIONS_KEY })
      queryClient.invalidateQueries({ queryKey: ['selection', editing.id] })
      toast.show({ message: 'Údaje výberu boli uložené.', tone: 'success' })
    } catch (err) {
      toast.error(err)
      throw err
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(s) {
    if (!window.confirm(`Naozaj zmazať výber „${s.name}" (${s.item_count} osôb)? Táto akcia sa nedá vrátiť.`)) return
    try {
      await deleteSelection(s.id)
      if (current.loaded?.id === s.id) current.detach()
      queryClient.invalidateQueries({ queryKey: SELECTIONS_KEY })
      toast.show({ message: `Výber „${s.name}" bol zmazaný.` })
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div>
      <PageHeader
        title="Uložené výbery"
        subtitle="Výbery sú spoločné pre celý tím. Otvorením do košíka ich môžete doplniť a aktualizovať."
        actions={<Input type="search" placeholder="Hľadať výber…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />}
      />

      <ErrorMessage error={query.error} onRetry={query.refetch} />
      {query.isLoading && <Spinner />}

      {!query.isLoading && list.length === 0 && (
        <EmptyState title={search ? 'Žiadny výber nezodpovedá hľadaniu' : 'Zatiaľ nie sú uložené žiadne výbery'}>
          {!search && 'Pridajte ľudí do výberu na obrazovke Ľudia a uložte ho v spodnom páse.'}
        </EmptyState>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((s) => {
          const canDelete = permissions.isAdmin || (permissions.canEdit && s.created_by === user.id)
          const isOpen = current.loaded?.id === s.id
          return (
            <Card key={s.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link to={`/vybery/${s.id}`} className="block truncate font-semibold text-stone-900 hover:underline">
                    {s.name}
                  </Link>
                  {(s.project_name || s.subtitle) && (
                    <p className="truncate text-sm text-stone-600">{[s.project_name, s.subtitle].filter(Boolean).join(' — ')}</p>
                  )}
                </div>
                <Badge>{s.item_count} os.</Badge>
              </div>
              <p className="text-xs text-stone-500">
                Vytvoril(a) {s.author_name} · upravené {formatDateTime(s.updated_at)}
                {s.updated_by_name && s.updated_by !== s.created_by ? ` (${s.updated_by_name})` : ''}
              </p>
              {isOpen && <Badge tone="info" className="self-start">otvorený v košíku</Badge>}
              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => openInCart(s.id)}>
                  Otvoriť do košíka
                </Button>
                <Button size="sm" onClick={() => navigate(`/vybery/${s.id}`)}>
                  Tabuľka
                </Button>
                {permissions.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Upraviť
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => onDelete(s)}>
                    Zmazať
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <SaveSelectionDialog open={!!editing} mode="edit" initial={editing} busy={busy} onClose={() => setEditing(null)} onSubmit={onSaveMeta} />
    </div>
  )
}
