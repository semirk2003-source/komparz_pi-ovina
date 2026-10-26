import { createContext, useContext } from 'react'

export const CurrentSelectionContext = createContext(null)

/**
 * Aktuálny výber — pracovný košík castingu (klientský stav).
 *
 * {
 *   items: [{ personId, note }],          // poradie = poradie pridania
 *   count, has(personId), toggle(personId), add(ids), remove(ids),
 *   setNote(personId, note),
 *   clear(),                                // vyprázdni, s možnosťou undo()
 *   undo(), canUndo,
 *   loaded: { id, name, project_name, subtitle, snapshot: [{personId, note}] } | null,
 *   loadSaved(selection, items),            // otvorí uložený výber do košíka
 *   markSaved(selection, items),            // po uložení nastaví nový snapshot
 *   detach(),                               // košík prestane byť viazaný na uložený výber
 * }
 */
export function useCurrentSelection() {
  const ctx = useContext(CurrentSelectionContext)
  if (!ctx) throw new Error('useCurrentSelection musí byť vnútri <CurrentSelectionProvider>.')
  return ctx
}
