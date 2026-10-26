// Základné UI prvky. Dizajn je zámerne jednoduchý — redizajn príde neskôr,
// preto všetky obrazovky skladáme z týchto prvkov a nie z ad-hoc štýlov.

import { useEffect, useId, useRef } from 'react'
import { cx } from '../lib/cx.js'

const BUTTON_VARIANTS = {
  primary: 'bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-400',
  secondary: 'bg-white text-stone-800 border border-stone-300 hover:bg-stone-50 disabled:text-stone-400',
  ghost: 'text-stone-700 hover:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-red-700 text-white hover:bg-red-600 disabled:bg-red-300',
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }) {
  const sizes = { sm: 'px-2.5 py-1 text-sm', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('flex flex-col gap-1 text-sm', className)}>
      {label && <span className="font-medium text-stone-700">{label}</span>}
      {children}
      {hint && !error && <span className="text-xs text-stone-500">{hint}</span>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200 disabled:bg-stone-100'

export function Input({ className, ...props }) {
  return <input className={cx(inputClass, className)} {...props} />
}

export function Textarea({ className, ...props }) {
  return <textarea className={cx(inputClass, 'min-h-20', className)} {...props} />
}

export function Select({ className, options, placeholder, ...props }) {
  return (
    <select className={cx(inputClass, 'pr-8', className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((opt) => {
        const o = typeof opt === 'object' ? opt : { value: opt, label: opt }
        return (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        )
      })}
      {!options && props.children}
    </select>
  )
}

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm text-stone-700', className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-stone-300 accent-stone-900" {...props} />
      {label}
    </label>
  )
}

export function Badge({ tone = 'neutral', className, ...props }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700',
    info: 'bg-sky-100 text-sky-800',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />
}

// Odstrániteľný štítok (aktívne filtre).
export function Chip({ children, onRemove, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white py-0.5 pl-2.5 pr-1 text-xs text-stone-700', className)}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded-full px-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900" aria-label="Odstrániť">
          ×
        </button>
      )}
    </span>
  )
}

export function Spinner({ label = 'Načítavam…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
      {label}
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-stone-800">{title}</p>
      {children && <div className="max-w-md text-sm text-stone-500">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Skúsiť znova
        </Button>
      )}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ className, ...props }) {
  return <div className={cx('rounded-xl border border-stone-200 bg-white', className)} {...props} />
}

// Otvorené modálne okná (posledné je navrchu) — Escape a Tab rieši len vrchné.
const modalStack = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modálne okno. size: 'sm' | 'md' | 'lg' | 'full'
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const titleId = useId()
  const panelRef = useRef(null)
  // onClose býva nová funkcia pri každom prekreslení; efekt nesmie kvôli
  // tomu bežať znova, inak by bral fokus z práve vypĺňaného políčka.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    const panel = panelRef.current
    const previouslyFocused = document.activeElement
    modalStack.push(panel)

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== panel) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key === 'Tab') {
        const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null)
        if (nodes.length === 0) {
          e.preventDefault()
          panel.focus()
          return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!panel.contains(document.activeElement)) panel.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      const idx = modalStack.lastIndexOf(panel)
      if (idx !== -1) modalStack.splice(idx, 1)
      document.body.style.overflow = prevOverflow
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  if (!open) return null
  const widths = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-5xl',
    full: 'max-w-none h-full sm:h-[calc(100%-2rem)]',
  }
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('flex max-h-full w-full flex-col overflow-hidden bg-white shadow-xl outline-none sm:rounded-2xl', widths[size])}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-stone-900">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl leading-none text-stone-500 hover:bg-stone-100" aria-label="Zavrieť">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
