import { createContext, useContext } from 'react'

export const ToastContext = createContext(null)

// toast.show({ message, tone: 'info'|'success'|'error', action: { label, onClick }, duration })
// toast.error(err) — zobrazí chybovú hlášku z výnimky
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast musí byť vnútri <ToastProvider>.')
  return ctx
}
