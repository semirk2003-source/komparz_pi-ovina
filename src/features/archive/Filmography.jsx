// Zmluva: <Filmography personId={number} /> — zoznam potvrdených účinkovaní osoby.
import { useFilmography } from './archiveQueries.js'
import { formatDate, countLabel } from '../../lib/format.js'
import { ErrorMessage, Spinner } from '../../components/ui.jsx'

export function Filmography({ personId }) {
  const { data, isLoading, error, refetch } = useFilmography(personId)

  if (isLoading) return <Spinner label="Načítavam filmografiu…" />
  if (error) return <ErrorMessage error={error} onRetry={refetch} />

  const { items, shootDays } = data
  if (items.length === 0) {
    return <p className="text-sm text-stone-500">Zatiaľ žiadne potvrdené účinkovanie v archíve.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-stone-700">
        <strong>{countLabel(shootDays, 'nakrúcací deň', 'nakrúcacie dni', 'nakrúcacích dní')}</strong>
        <span className="text-stone-500"> · {countLabel(items.length, 'záznam', 'záznamy', 'záznamov')}</span>
      </p>
      <div className="max-h-80 overflow-auto rounded-lg border border-stone-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Dátum</th>
              <th className="px-3 py-2 font-medium">Postava</th>
              <th className="px-3 py-2 font-medium">Projekt</th>
              <th className="px-3 py-2 font-medium">Séria</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{formatDate(a.shoot_date)}</td>
                <td className="px-3 py-1.5">{a.role_effective || '—'}</td>
                <td className="px-3 py-1.5">{a.production_effective || '—'}</td>
                <td className="px-3 py-1.5 text-stone-600">{a.series_effective || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
