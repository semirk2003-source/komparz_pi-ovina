// Čistá logika pracovného košíka (bez Reactu), aby sa dala testovať.

export const CURRENT_SELECTION_STORAGE_KEY = 'komparz-current-selection-v1'
export const UNDO_LIMIT = 20
// Okno udalosť pri výslovnom odhlásení — košík sa vyprázdni.
export const SIGN_OUT_EVENT = 'komparz-sign-out'

// owner: id používateľa, ktorému košík patrí — iný používateľ na tom istom
// počítači ho nesmie zdediť.
export const initialState = Object.freeze({ items: [], loaded: null, history: [], owner: null })

export function toItems(items) {
  return (items || [])
    .map((i) => ({ personId: i?.personId ?? i?.person_id, note: i?.note || '' }))
    .filter((i) => Number.isFinite(i.personId))
}

export function readStored(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CURRENT_SELECTION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return null
    return {
      items: toItems(parsed.items),
      loaded: parsed.loaded && Number.isFinite(parsed.loaded.id) ? parsed.loaded : null,
      history: [],
      owner: typeof parsed.owner === 'string' ? parsed.owner : null,
    }
  } catch {
    return null
  }
}

function withHistory(state, next) {
  return { ...next, history: [...state.history, { items: state.items, loaded: state.loaded }].slice(-UNDO_LIMIT) }
}

function loadedFrom(selection, list) {
  return {
    id: selection.id,
    name: selection.name,
    project_name: selection.project_name || '',
    subtitle: selection.subtitle || '',
    snapshot: list,
  }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'toggle': {
      const exists = state.items.some((i) => i.personId === action.personId)
      const items = exists
        ? state.items.filter((i) => i.personId !== action.personId)
        : [...state.items, { personId: action.personId, note: '' }]
      return withHistory(state, { ...state, items })
    }
    case 'add': {
      const present = new Set(state.items.map((i) => i.personId))
      const added = []
      for (const personId of action.personIds) {
        if (present.has(personId)) continue
        present.add(personId)
        added.push({ personId, note: '' })
      }
      if (added.length === 0) return state
      return withHistory(state, { ...state, items: [...state.items, ...added] })
    }
    case 'remove': {
      const drop = new Set(action.personIds)
      const items = state.items.filter((i) => !drop.has(i.personId))
      if (items.length === state.items.length) return state
      return withHistory(state, { ...state, items })
    }
    case 'note':
      return {
        ...state,
        items: state.items.map((i) => (i.personId === action.personId ? { ...i, note: action.note } : i)),
      }
    case 'clear':
      if (state.items.length === 0 && !state.loaded) return state
      return withHistory(state, { ...state, items: [], loaded: null })
    case 'undo': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      return { ...state, items: prev.items, loaded: prev.loaded, history: state.history.slice(0, -1) }
    }
    case 'load': {
      const list = toItems(action.items)
      return withHistory(state, { ...state, items: list, loaded: loadedFrom(action.selection, list) })
    }
    case 'saved': {
      const list = toItems(action.items)
      return { ...state, items: list, loaded: loadedFrom(action.selection, list) }
    }
    case 'detach':
      return { ...state, loaded: null }
    case 'owner':
      if (state.owner === action.owner) return state
      // Košík iného používateľa sa zahodí aj s históriou (bez možnosti „späť").
      if (state.owner && state.owner !== action.owner) return { ...initialState, owner: action.owner }
      return { ...state, owner: action.owner }
    case 'reset':
      return { ...initialState }
    default:
      return state
  }
}
