import { useMemo, useState } from 'react'
import { Badge, Input } from '../../components/ui.jsx'
import { nameWithId, normalizeText } from '../../lib/format.js'
import { suggestPeople, countNamesakes } from '../../lib/nameMatch.js'
import { cx } from '../../lib/cx.js'
import { personHint } from './archiveUtils.js'

/**
 * Našepkávač profilu vo formáte „Meno Priezvisko [ID]".
 * Bez textu zobrazí návrhy podľa podobnosti s rawName.
 */
export function PersonPicker({ rawName, people, onPick, selectedId }) {
  const [query, setQuery] = useState('')

  const suggestions = useMemo(
    () => (rawName ? suggestPeople(rawName, people, { limit: 6, minScore: 0.75 }) : []),
    [rawName, people],
  )

  const results = useMemo(() => {
    const q = normalizeText(query)
    if (!q) return suggestions
    const idMatch = q.match(/^\[?(\d+)\]?$/)
    const out = []
    for (const p of people) {
      if (idMatch ? String(p.id) === idMatch[1] : normalizeText(`${p.first_name} ${p.last_name} ${p.last_name} ${p.first_name}`).includes(q)) {
        out.push({ person: p, score: null })
        if (out.length >= 30) break
      }
    }
    return out
  }, [query, suggestions, people])

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        placeholder="Začnite písať meno alebo ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Hľadať profil"
      />
      {!query && suggestions.length > 0 && <p className="text-xs text-stone-500">Návrhy podľa podobnosti mena:</p>}
      <ul className="max-h-72 overflow-auto rounded-lg border border-stone-200" role="listbox">
        {results.length === 0 && <li className="px-3 py-3 text-sm text-stone-500">Nič sa nenašlo.</li>}
        {results.map(({ person, score }) => {
          const namesakes = countNamesakes(person, people)
          return (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={selectedId === person.id}
                onClick={() => onPick(person)}
                className={cx(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-50',
                  selectedId === person.id && 'bg-stone-100',
                )}
              >
                <span>
                  <span className="font-medium text-stone-900">{nameWithId(person)}</span>
                  <span className="ml-2 text-xs text-stone-500">{personHint(person)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {namesakes > 1 && <Badge tone="warning">menovec ×{namesakes}</Badge>}
                  {score != null && <Badge tone="neutral">{Math.round(score * 100)} %</Badge>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
