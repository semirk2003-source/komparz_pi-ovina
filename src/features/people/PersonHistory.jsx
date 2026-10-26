import { useState } from 'react'
import { Button, ErrorMessage, Spinner } from '../../components/ui.jsx'
import { formatDateTime } from '../../lib/format.js'
import { usePersonHistory } from './hooks.js'

const FIELD_LABELS = {
  first_name: 'meno', last_name: 'priezvisko', gender: 'pohlavie', birth_date: 'dátum narodenia',
  birth_date_approx: 'približný dátum', phone: 'telefón', email: 'e-mail', address: 'adresa', city: 'mesto',
  region: 'región', height_cm: 'výška', clothing_size: 'konfekcia', shoe_size: 'topánky', hair_color: 'vlasy',
  eye_color: 'oči', has_tattoos: 'tetovania', tattoo_note: 'popis tetovania', languages: 'jazyky',
  driving_licence: 'vodičák', skills: 'zručnosti', period_look: 'dobový vzhľad', speaking_role: 'textujúci',
  notes: 'poznámky', is_active: 'aktívny', anonymized_at: 'anonymizácia', consent_at: 'súhlas',
  last_contacted_at: 'naposledy kontaktovaný', is_primary: 'hlavná fotka', sort_order: 'poradie fotky',
  taken_on: 'dátum nafotenia',
}
const IGNORED = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'id'])

function show(v) {
  if (v == null || v === '') return '∅'
  if (Array.isArray(v)) return v.join(', ') || '∅'
  if (typeof v === 'boolean') return v ? 'áno' : 'nie'
  return String(v)
}

function describe(row) {
  const isPhoto = row.table_name === 'person_photos'
  if (row.action === 'INSERT') return [isPhoto ? 'Pridaná fotografia' : 'Profil vytvorený']
  if (row.action === 'DELETE') return [isPhoto ? 'Zmazaná fotografia' : 'Profil zmazaný']
  const before = row.old_data || {}
  const after = row.new_data || {}
  const changes = []
  for (const key of Object.keys(after)) {
    if (IGNORED.has(key)) continue
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
    if (!(key in before) && isPhoto) continue
    changes.push(`${FIELD_LABELS[key] || key}: ${show(before[key])} → ${show(after[key])}`)
  }
  if (changes.length === 0) return [isPhoto ? 'Úprava fotografie' : 'Úprava profilu']
  return changes
}

// História zmien profilu (kto, kedy, čo). Načíta sa až na požiadanie.
export function PersonHistory({ personId }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch } = usePersonHistory(personId, open)

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">História zmien</h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Skryť' : 'Zobraziť'}
        </Button>
      </div>
      {open && (
        <>
          {isLoading && <Spinner />}
          <ErrorMessage error={error} onRetry={refetch} />
          {data && data.length === 0 && <p className="text-sm text-stone-500">Zatiaľ bez zaznamenaných zmien.</p>}
          {data && data.length > 0 && (
            <ol className="flex flex-col gap-2 border-l border-stone-200 pl-3 text-sm">
              {data.map((row) => (
                <li key={row.id}>
                  <div className="text-xs text-stone-500">
                    {formatDateTime(row.changed_at)} · {row.changed_by_name || 'systém'}
                  </div>
                  <ul className="text-stone-800">
                    {describe(row).map((line, i) => (
                      <li key={i} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
