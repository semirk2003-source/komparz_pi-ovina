import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { usePermissions } from '../../auth/AuthContext.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { usePeopleList } from '../../hooks/usePeopleList.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { Badge, Button, EmptyState, Modal, Textarea } from '../../components/ui.jsx'
import { formatAge, fullName } from '../../lib/format.js'
import { SaveSelectionDialog } from './SaveSelectionDialog.jsx'
import { useSaveSelection } from './useSaveSelection.js'
import { usePeopleContacts } from './useSelectionRows.js'

const PREVIEW_FACES = 8

// Pás pri spodnom okraji obrazovky — aktuálny výber je viditeľný stále.
export function SelectionBar() {
  const selection = useCurrentSelection()
  const { byId } = usePeopleList()
  const [expanded, setExpanded] = useState(false)
  const save = useSaveSelection()
  const { canEdit } = usePermissions()

  if (selection.count === 0 && !selection.loaded) return null

  const faces = selection.items.slice(0, PREVIEW_FACES).map((i) => byId.get(i.personId)).filter(Boolean)
  const rest = selection.count - faces.length

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur print:hidden">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2.5 text-left"
          aria-label="Rozbaliť aktuálny výber"
        >
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
              {selection.loaded ? 'Otvorený výber' : 'Aktuálny výber'}
            </span>
            <span className="truncate text-sm font-semibold text-stone-900">
              {selection.loaded ? selection.loaded.name : `${selection.count} ${selection.count === 1 ? 'osoba' : selection.count < 5 ? 'osoby' : 'osôb'}`}
              {selection.loaded && <span className="font-normal text-stone-500"> · {selection.count}</span>}
            </span>
          </div>
          {canEdit && save.hasUnsaved && <Badge tone="warning">neuložené zmeny</Badge>}
          <div className="ml-auto flex items-center">
            <div className="hidden -space-x-2 sm:flex">
              {faces.map((p) => (
                <PersonPhoto key={p.id} path={p.thumb_path} alt={fullName(p)} className="h-9 w-9 rounded-full border-2 border-white" />
              ))}
            </div>
            <div className="flex -space-x-2 sm:hidden">
              {faces.slice(0, 3).map((p) => (
                <PersonPhoto key={p.id} path={p.thumb_path} alt={fullName(p)} className="h-8 w-8 rounded-full border-2 border-white" />
              ))}
            </div>
            {rest > 0 && <span className="ml-2 text-sm font-medium text-stone-600">+{rest}</span>}
            <span className="ml-3 rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">Otvoriť</span>
          </div>
        </button>
      </div>
      {expanded && <SelectionPanel onClose={() => setExpanded(false)} save={save} />}
    </>
  )
}

function SelectionPanel({ onClose, save }) {
  const selection = useCurrentSelection()
  const { canEdit, canSeeContacts } = usePermissions()
  const { byId } = usePeopleList()
  const openProfile = useOpenProfile()
  const navigate = useNavigate()
  const toast = useToast()
  const [dialog, setDialog] = useState(null) // 'new' | 'update'

  const personIds = useMemo(() => selection.items.map((i) => i.personId), [selection.items])
  const contacts = usePeopleContacts(personIds, canSeeContacts)

  // Keď sa výber vyprázdni a nie je otvorený uložený, zavrieť panel.
  useEffect(() => {
    if (selection.count === 0 && !selection.loaded) onClose()
  }, [selection.count, selection.loaded, onClose])

  function clearAll() {
    const n = selection.count
    selection.clear()
    toast.show({
      message: `Výber bol vyprázdnený (${n}).`,
      action: { label: 'Späť', onClick: selection.undo },
    })
  }

  function removeOne(personId, name) {
    selection.remove(personId)
    toast.show({ message: `${name} odobratý z výberu.`, action: { label: 'Späť', onClick: selection.undo } })
  }

  function goToTable() {
    onClose()
    navigate(selection.loaded && !save.hasUnsaved ? `/vybery/${selection.loaded.id}` : '/vybery/aktualny')
  }

  const meta = selection.loaded
    ? { name: selection.loaded.name, project_name: selection.loaded.project_name, subtitle: selection.loaded.subtitle }
    : null

  const footer = (
    <>
      <Button variant="ghost" onClick={clearAll} disabled={selection.count === 0 && !selection.loaded}>
        Vyprázdniť
      </Button>
      {selection.loaded && (
        <Button variant="ghost" onClick={() => selection.detach()} title="Košík prestane byť viazaný na uložený výber">
          Odpojiť od uloženého
        </Button>
      )}
      <div className="flex-1" />
      <Button onClick={goToTable} disabled={selection.count === 0}>
        Tabuľka a exporty
      </Button>
      {canEdit && selection.loaded && (
        <Button variant="primary" onClick={() => save.updateLoaded().catch(() => {})} disabled={save.saving || !save.diff?.hasChanges}>
          {save.saving ? 'Ukladám…' : 'Aktualizovať tento'}
        </Button>
      )}
      {canEdit && (
        <Button variant={selection.loaded ? 'secondary' : 'primary'} onClick={() => setDialog('new')} disabled={selection.count === 0}>
          Uložiť ako nový
        </Button>
      )}
    </>
  )

  return (
    <Modal open onClose={onClose} size="full" title={selection.loaded ? `Výber: ${selection.loaded.name}` : 'Aktuálny výber'} footer={footer}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
        <span>
          {selection.count} {selection.count === 1 ? 'osoba' : selection.count < 5 ? 'osoby' : 'osôb'}
        </span>
        {selection.loaded?.project_name && <span>· projekt {selection.loaded.project_name}</span>}
        {canEdit && save.diff?.hasChanges && (
          <Badge tone="warning">
            neuložené: +{save.diff.added.length} / −{save.diff.removed.length}
            {save.diff.notes.length > 0 && ` / ${save.diff.notes.length} pozn.`}
          </Badge>
        )}
        {!canEdit && <Badge>len na čítanie — výbery ukladá casting</Badge>}
        {selection.canUndo && (
          <Button size="sm" variant="ghost" onClick={selection.undo}>
            ↶ Krok späť
          </Button>
        )}
      </div>

      {selection.count === 0 ? (
        <EmptyState title="Výber je prázdny">Pridávajte ľudí tlačidlom + na dlaždiciach profilov.</EmptyState>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {selection.items.map((item) => {
            const p = byId.get(item.personId)
            const c = contacts.data?.get?.(item.personId)
            const name = p ? fullName(p) : `Profil #${item.personId}`
            return (
              <li key={item.personId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 gap-3">
                  <button type="button" onClick={() => openProfile(item.personId)} className="shrink-0" aria-label={`Otvoriť profil ${name}`}>
                    <PersonPhoto path={p?.thumb_path} alt={name} className="h-20 w-16 rounded-lg" />
                  </button>
                  <div className="min-w-0 flex-1 text-sm">
                    <button type="button" onClick={() => openProfile(item.personId)} className="font-semibold text-stone-900 hover:underline">
                      {name}
                    </button>
                    {p && (
                      <p className="text-stone-600">
                        {[formatAge(p.age), p.city, p.clothing_size && `konf. ${p.clothing_size}`, p.shoe_size && `top. ${p.shoe_size}`, p.height_cm && `${p.height_cm} cm`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {canSeeContacts && (
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {c?.phone ? (
                          <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="font-medium text-sky-800 underline">
                            📞 {c.phone}
                          </a>
                        ) : (
                          contacts.data && <span className="text-red-700">telefón chýba</span>
                        )}
                        {c?.email && (
                          <a href={`mailto:${c.email}`} className="text-sky-800 underline">
                            {c.email}
                          </a>
                        )}
                      </p>
                    )}
                    {!p && <p className="text-red-700">Profil nie je dostupný (neaktívny alebo anonymizovaný).</p>}
                  </div>
                </div>
                <div className="flex gap-2 sm:w-80">
                  <Textarea
                    aria-label={`Poznámka k výberu pre ${name}`}
                    placeholder="Poznámka k tomuto výberu…"
                    className="min-h-14 flex-1 text-sm"
                    value={item.note || ''}
                    onChange={(e) => selection.setNote(item.personId, e.target.value)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => removeOne(item.personId, name)} aria-label={`Odobrať ${name}`}>
                    ✕
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <SaveSelectionDialog
        open={dialog === 'new'}
        mode="new"
        busy={save.saving}
        initial={meta ? { ...meta, name: `${meta.name} (kópia)` } : null}
        onClose={() => setDialog(null)}
        onSubmit={(m) => save.saveAsNew(m)}
      />
    </Modal>
  )
}
