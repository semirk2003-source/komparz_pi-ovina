import { useMemo, useState } from 'react'
import { Input } from '../../components/ui.jsx'
import { normalizeText } from '../../lib/format.js'

// Viacnásobný výber hodnôt s vyhľadávaním (napr. postavy).
export function MultiSelect({ label, options, value, onChange, placeholder = 'Všetky' }) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  const visible = useMemo(() => {
    const q = normalizeText(query)
    return q ? options.filter((o) => normalizeText(o.value).includes(q)) : options
  }, [options, query])

  function toggle(v) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange([...next])
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
        <span className="truncate">
          {value.length === 0 ? <span className="text-stone-500">{placeholder}</span> : `${label}: ${value.length}`}
        </span>
        <span className="text-stone-400 group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
        <Input placeholder="Hľadať…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />
        <div className="max-h-64 overflow-auto">
          {visible.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-stone-50">
              <span className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-stone-900" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                {o.value}
              </span>
              <span className="text-xs text-stone-400">{o.count}</span>
            </label>
          ))}
          {visible.length === 0 && <p className="px-2 py-1 text-sm text-stone-500">Nič sa nenašlo.</p>}
        </div>
        {value.length > 0 && (
          <button type="button" className="mt-2 text-xs text-stone-600 underline" onClick={() => onChange([])}>
            Zrušiť výber
          </button>
        )}
      </div>
    </details>
  )
}
