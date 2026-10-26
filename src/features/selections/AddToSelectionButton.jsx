import { useCurrentSelection } from '../../state/CurrentSelectionContext.js'
import { cx } from '../../lib/cx.js'

// Prepínač pridať/odobrať osobu v aktuálnom výbere (košíku).
// size: 'sm' (ikona na dlaždici) | 'md' (tlačidlo s textom)
export function AddToSelectionButton({ personId, size = 'md', className }) {
  const { has, toggle } = useCurrentSelection()
  const selected = has(personId)

  function onClick(e) {
    e.stopPropagation()
    e.preventDefault()
    toggle(personId)
  }

  if (size === 'sm') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={selected ? 'Odobrať z výberu' : 'Pridať do výberu'}
        aria-label={selected ? 'Odobrať z výberu' : 'Pridať do výberu'}
        className={cx(
          'flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold shadow-sm transition-colors',
          selected ? 'bg-stone-900 text-white hover:bg-stone-700' : 'bg-white/95 text-stone-800 hover:bg-white',
          className,
        )}
      >
        {selected ? '✓' : '+'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        selected ? 'bg-stone-900 text-white hover:bg-stone-700' : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50',
        className,
      )}
    >
      {selected ? '✓ Vo výbere' : '+ Pridať do výberu'}
    </button>
  )
}
