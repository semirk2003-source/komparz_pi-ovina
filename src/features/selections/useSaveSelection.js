import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { usePermissions } from '../../auth/AuthContext.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { applySelectionChanges, createSelection, diffSelection, getSelection } from '../../api/selections.js'
import { AppError } from '../../api/backend.js'

export const SELECTIONS_KEY = ['selections']
export const selectionKey = (id) => ['selection', Number(id)]

// Uloženie košíka: ako nový výber alebo aktualizácia otvoreného (len rozdiel).
export function useSaveSelection() {
  const selection = useCurrentSelection()
  const { canEdit } = usePermissions()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  const diff = useMemo(
    () => (selection.loaded ? diffSelection(selection.loaded.snapshot, selection.items) : null),
    [selection.loaded, selection.items],
  )

  const invalidate = useCallback(
    (id) => {
      queryClient.invalidateQueries({ queryKey: SELECTIONS_KEY })
      if (id != null) queryClient.invalidateQueries({ queryKey: selectionKey(id) })
    },
    [queryClient],
  )

  const saveAsNew = useCallback(
    async (meta) => {
      if (!canEdit) throw new AppError('Na ukladanie výberov nemáte oprávnenie.', 'forbidden')
      setSaving(true)
      try {
        const created = await createSelection(meta, selection.items)
        const fresh = await getSelection(created.id)
        selection.markSaved(fresh.selection, fresh.items)
        invalidate(created.id)
        toast.show({ message: `Výber „${fresh.selection.name}" bol uložený.`, tone: 'success' })
        return fresh.selection
      } catch (err) {
        toast.error(err)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [canEdit, selection, invalidate, toast],
  )

  // Vráti do uloženého výberu osoby, ktoré kolega odobral, aj s našimi poznámkami.
  const restoreLost = useCallback(
    async (selectionId, lost) => {
      try {
        const fresh = await applySelectionChanges(selectionId, null, { added: lost })
        if (selection.loaded?.id === selectionId) selection.markSaved(fresh.selection, fresh.items)
        invalidate(selectionId)
        toast.show({ message: 'Osoby sú vrátené do výberu aj s poznámkami.', tone: 'success' })
      } catch (err) {
        toast.error(err)
      }
    },
    [selection, invalidate, toast],
  )

  // Aktualizuje otvorený výber — pošle len pridané, odobraté a zmenené poznámky.
  // Položky, ktoré medzitým pridal niekto iný, zostanú a objavia sa v košíku.
  const updateLoaded = useCallback(
    async (meta) => {
      if (!canEdit) throw new AppError('Na ukladanie výberov nemáte oprávnenie.', 'forbidden')
      const loaded = selection.loaded
      if (!loaded) return null
      setSaving(true)
      try {
        const changes = diffSelection(loaded.snapshot, selection.items)
        const fresh = await applySelectionChanges(loaded.id, meta || null, changes)
        const before = new Set(selection.items.map((i) => i.personId))
        const fromOthers = fresh.items.filter((i) => !before.has(i.person_id)).length
        selection.markSaved(fresh.selection, fresh.items)
        invalidate(loaded.id)
        const lost = fresh.lostNotes || []
        if (lost.length) {
          // Kolega medzitým osobu z výberu odobral — poznámka sa neuložila.
          toast.show({
            message: `${lost.length === 1 ? 'Jednu osobu' : `${lost.length} osoby/osôb`} medzitým niekto z výberu odobral, preto sa ${lost.length === 1 ? 'jej poznámka' : 'ich poznámky'} neuložili.`,
            tone: 'error',
            duration: 15000,
            action: {
              label: 'Vrátiť do výberu',
              onClick: () => restoreLost(loaded.id, lost),
            },
          })
        } else {
          toast.show({
            message: fromOthers
              ? `Výber aktualizovaný. Kolegovia medzitým pridali ${fromOthers} ${fromOthers === 1 ? 'osobu' : 'osoby/osôb'} — sú teraz v košíku.`
              : 'Výber bol aktualizovaný.',
            tone: 'success',
          })
        }
        return fresh.selection
      } catch (err) {
        toast.error(err)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [canEdit, selection, invalidate, toast, restoreLost],
  )

  return { saveAsNew, updateLoaded, saving, diff, hasUnsaved: selection.loaded ? !!diff?.hasChanges : selection.count > 0 }
}

// Otvorí uložený výber do košíka. Ak košík obsahuje neuložené zmeny, opýta sa.
export function useOpenSelectionInCart() {
  const selection = useCurrentSelection()
  const toast = useToast()
  return useCallback(
    async (id) => {
      const dirty = selection.loaded
        ? diffSelection(selection.loaded.snapshot, selection.items).hasChanges
        : selection.count > 0
      if (dirty && selection.loaded?.id !== Number(id)) {
        const ok = window.confirm('V aktuálnom výbere máte neuložené zmeny. Nahradiť ho uloženým výberom? (Dá sa vrátiť tlačidlom Späť.)')
        if (!ok) return false
      }
      try {
        const fresh = await getSelection(id)
        selection.loadSaved(fresh.selection, fresh.items)
        toast.show({
          message: `Otvorený výber „${fresh.selection.name}".`,
          action: dirty ? { label: 'Späť', onClick: selection.undo } : undefined,
        })
        return true
      } catch (err) {
        toast.error(err)
        return false
      }
    },
    [selection, toast],
  )
}
