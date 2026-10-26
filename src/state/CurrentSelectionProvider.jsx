import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { CurrentSelectionContext } from './CurrentSelectionContext.js'
import { CURRENT_SELECTION_STORAGE_KEY, SIGN_OUT_EVENT, initialState, readStored, reducer } from './currentSelectionReducer.js'
import { useAuth } from '../auth/AuthContext.js'

export function CurrentSelectionProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, () => readStored() || initialState)
  const { status, user } = useAuth()
  const userId = status === 'ready' ? user.id : null

  useEffect(() => {
    if (userId) dispatch({ type: 'owner', owner: userId })
  }, [userId])

  useEffect(() => {
    const onSignOut = () => dispatch({ type: 'reset' })
    window.addEventListener(SIGN_OUT_EVENT, onSignOut)
    return () => window.removeEventListener(SIGN_OUT_EVENT, onSignOut)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        CURRENT_SELECTION_STORAGE_KEY,
        JSON.stringify({ items: state.items, loaded: state.loaded, owner: state.owner }),
      )
    } catch {
      // nedostupné úložisko — košík žije len v pamäti
    }
  }, [state.items, state.loaded, state.owner])

  const idSet = useMemo(() => new Set(state.items.map((i) => i.personId)), [state.items])

  const has = useCallback((personId) => idSet.has(personId), [idSet])
  const toggle = useCallback((personId) => dispatch({ type: 'toggle', personId }), [])
  const add = useCallback((personIds) => dispatch({ type: 'add', personIds: [].concat(personIds) }), [])
  const remove = useCallback((personIds) => dispatch({ type: 'remove', personIds: [].concat(personIds) }), [])
  const setNote = useCallback((personId, note) => dispatch({ type: 'note', personId, note }), [])
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const detach = useCallback(() => dispatch({ type: 'detach' }), [])
  const loadSaved = useCallback((selection, items) => dispatch({ type: 'load', selection, items }), [])
  const markSaved = useCallback((selection, items) => dispatch({ type: 'saved', selection, items }), [])

  const value = useMemo(
    () => ({
      items: state.items,
      count: state.items.length,
      loaded: state.loaded,
      canUndo: state.history.length > 0,
      has, toggle, add, remove, setNote, clear, undo, loadSaved, markSaved, detach,
    }),
    [state, has, toggle, add, remove, setNote, clear, undo, loadSaved, markSaved, detach],
  )

  return <CurrentSelectionContext.Provider value={value}>{children}</CurrentSelectionContext.Provider>
}
