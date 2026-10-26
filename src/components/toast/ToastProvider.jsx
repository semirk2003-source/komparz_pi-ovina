import { useCallback, useMemo, useRef, useState } from 'react'
import { ToastContext } from './ToastContext.js'

let seq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    ({ message, tone = 'info', action, duration }) => {
      const id = ++seq
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }])
      const ms = duration ?? (action ? 8000 : 4000)
      timers.current.set(id, setTimeout(() => dismiss(id), ms))
      return id
    },
    [dismiss],
  )

  const error = useCallback(
    (err) => show({ message: err?.message || 'Nastala chyba.', tone: 'error', duration: 7000 }),
    [show],
  )

  const value = useMemo(() => ({ show, error, dismiss }), [show, error, dismiss])
  const tones = {
    info: 'bg-stone-900 text-white',
    success: 'bg-emerald-700 text-white',
    error: 'bg-red-700 text-white',
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-lg ${tones[t.tone]}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="rounded-md bg-white/15 px-2 py-1 font-semibold hover:bg-white/25"
                onClick={() => {
                  t.action.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="text-white/70 hover:text-white" onClick={() => dismiss(t.id)} aria-label="Zavrieť">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
