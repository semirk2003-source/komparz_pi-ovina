import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, Card, Checkbox, EmptyState, ErrorMessage, Field, Input, PageHeader, Select, Spinner,
} from '../../components/ui.jsx'
import { useToast } from '../../components/toast/ToastContext.js'
import { cx } from '../../lib/cx.js'
import { countLabel } from '../../lib/format.js'
import { PEOPLE_LIST_KEY } from '../../hooks/usePeopleList.js'
import { createRegistration, deleteRegistration, listRegistrations } from '../../api/admin.js'
import {
  DUPLICATE_ACTIONS, EXTRA, IMPORT_FIELDS, OUTCOME_LABELS, SKIP,
  autoMapColumns, buildPreview, executeImport, isStrongMatch, loadMatchIndex, parseImportFile, protocolToCsv, validateMapping,
} from '../../api/import.js'
import { REGISTRATIONS_ALL_KEY, REGISTRATIONS_KEY } from './queryKeys.js'

const STEPS = ['Súbor', 'Stĺpce', 'Náhľad', 'Duplicity', 'Výsledok']
const PAGE = 100

export function ImportPage() {
  const [step, setStep] = useState(0)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState([])
  const [registration, setRegistration] = useState({ mode: 'existing', id: '', name: '' })
  const [strict, setStrict] = useState(true)
  const [preview, setPreview] = useState(null)
  const [defaultAction, setDefaultAction] = useState(DUPLICATE_ACTIONS.SKIP)
  const [overrides, setOverrides] = useState({})
  const [protocol, setProtocol] = useState(null)

  function reset() {
    setStep(0)
    setParsed(null)
    setMapping([])
    setPreview(null)
    setOverrides({})
    setProtocol(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Import registračnej vlny"
        subtitle="Nahrajte CSV alebo XLSX. Pred zápisom vždy uvidíte, čo sa stane."
        actions={step > 0 && step < 4 && <Button onClick={reset}>Začať odznova</Button>}
      />
      <Stepper step={step} />

      {step === 0 && (
        <FileStep
          registration={registration}
          setRegistration={setRegistration}
          onParsed={(p) => {
            setParsed(p)
            setMapping(autoMapColumns(p.headers))
            setStep(1)
          }}
        />
      )}
      {step === 1 && parsed && (
        <MappingStep
          parsed={parsed}
          mapping={mapping}
          setMapping={setMapping}
          strict={strict}
          setStrict={setStrict}
          onBack={() => setStep(0)}
          onPreview={(p) => {
            setPreview(p)
            setOverrides({})
            setStep(2)
          }}
        />
      )}
      {step === 2 && preview && (
        <PreviewStep preview={preview} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && preview && (
        <DuplicatesStep
          preview={preview}
          registration={registration}
          defaultAction={defaultAction}
          setDefaultAction={setDefaultAction}
          overrides={overrides}
          setOverrides={setOverrides}
          onBack={() => setStep(2)}
          onDone={(p) => {
            setProtocol(p)
            setStep(4)
          }}
        />
      )}
      {step === 4 && protocol && (
        <ResultStep protocol={protocol.protocol} warnings={protocol.warnings} fileName={parsed?.fileName} onNew={reset} />
      )}
    </div>
  )
}

function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={cx(
            'flex items-center gap-2 rounded-full border px-3 py-1',
            i === step ? 'border-stone-900 bg-stone-900 text-white' : i < step ? 'border-stone-300 bg-white text-stone-700' : 'border-stone-200 text-stone-400',
          )}
        >
          <span className="font-semibold">{i + 1}.</span> {label}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------
// 1. Súbor a vlna
// ---------------------------------------------------------------------

function FileStep({ registration, setRegistration, onParsed }) {
  const { data: regs = [], isLoading } = useQuery({ queryKey: REGISTRATIONS_KEY, queryFn: listRegistrations })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const regValid = registration.mode === 'none' || (registration.mode === 'existing' ? !!registration.id : !!registration.name.trim())

  async function next() {
    setBusy(true)
    setError(null)
    try {
      onParsed(await parseImportFile(file))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-5">
      <Field label="Súbor (CSV alebo XLSX)" hint="CSV ideálne v kódovaní UTF-8. Prvý riadok musí byť hlavička.">
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.tsv,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-white"
        />
      </Field>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium text-stone-700">Registračná vlna, ku ktorej ľudí priradiť</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={registration.mode === 'existing'} onChange={() => setRegistration({ ...registration, mode: 'existing' })} />
          Existujúca vlna
        </label>
        {registration.mode === 'existing' &&
          (isLoading ? (
            <Spinner />
          ) : (
            <Select
              className="ml-6 max-w-sm"
              placeholder="— vyberte —"
              value={registration.id}
              onChange={(e) => setRegistration({ ...registration, id: e.target.value })}
              options={regs.map((r) => ({ value: String(r.id), label: `${r.name} (${r.people_count})` }))}
            />
          ))}
        <label className="flex items-center gap-2">
          <input type="radio" checked={registration.mode === 'new'} onChange={() => setRegistration({ ...registration, mode: 'new' })} />
          Nová vlna
        </label>
        {registration.mode === 'new' && (
          <Input className="ml-6 max-w-sm" placeholder="Napr. Nábor jar 2027" value={registration.name} onChange={(e) => setRegistration({ ...registration, name: e.target.value })} />
        )}
        <label className="flex items-center gap-2">
          <input type="radio" checked={registration.mode === 'none'} onChange={() => setRegistration({ ...registration, mode: 'none' })} />
          Nepriraďovať k vlne (doplnkové stĺpce sa potom neuložia)
        </label>
      </fieldset>

      <ErrorMessage error={error} />
      <div>
        <Button variant="primary" disabled={!file || !regValid || busy} onClick={next}>
          {busy ? 'Čítam súbor…' : 'Pokračovať na priradenie stĺpcov'}
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// 2. Priradenie stĺpcov
// ---------------------------------------------------------------------

function MappingStep({ parsed, mapping, setMapping, strict, setStrict, onBack, onPreview }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const problems = validateMapping(mapping)
  const sample = parsed.rows.slice(0, 3)

  const options = [
    { value: EXTRA, label: '→ Doplnková odpoveď vlny' },
    { value: SKIP, label: '✕ Neimportovať' },
    ...IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label })),
  ]

  async function preview() {
    setBusy(true)
    setError(null)
    try {
      const started = performance.now()
      const index = await loadMatchIndex()
      const result = buildPreview({ headers: parsed.headers, rows: parsed.rows, mapping, index, strict })
      result.durationMs = Math.round(performance.now() - started)
      result.existingCount = index.count
      onPreview(result)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="text-sm text-stone-600">
        Súbor <strong>{parsed.fileName}</strong> · {countLabel(parsed.rows.length, 'riadok', 'riadky', 'riadkov')} ·{' '}
        {countLabel(parsed.headers.length, 'stĺpec', 'stĺpce', 'stĺpcov')}
        {parsed.encoding && ` · kódovanie ${parsed.encoding}`}
      </div>
      {parsed.warnings.map((w) => (
        <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {w}
        </p>
      ))}
      <p className="text-sm text-stone-600">
        Skontrolujte, ako sa stĺpce súboru priradili k poliam databázy. Stĺpce, ktoré do profilu nepatria, sa uložia ako doplnkové
        odpovede k registračnej vlne — nič sa nezahodí.
      </p>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Doplnkové odpovede vidia všetci prihlásení vrátane prizeraných. Kontakty a citlivé údaje (telefón, e-mail, adresa, číslo
        účtu, rodné číslo) do nich nedávajte — stĺpce, ktoré tak vyzerajú, sú predvolene nastavené na „Neimportovať".
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2 pr-3 font-medium">Stĺpec v súbore</th>
              <th className="py-2 pr-3 font-medium">Pole v databáze</th>
              <th className="py-2 font-medium">Ukážka hodnôt</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((h, i) => (
              <tr key={`${h}-${i}`} className="border-b border-stone-100 align-top">
                <td className="py-2 pr-3 font-medium text-stone-800">{h}</td>
                <td className="py-2 pr-3">
                  <Select
                    className="min-w-56"
                    value={mapping[i]}
                    onChange={(e) => setMapping(mapping.map((m, k) => (k === i ? e.target.value : m)))}
                    options={options}
                  />
                </td>
                <td className="py-2 text-stone-500">
                  {sample.map((r, k) => (
                    <div key={k} className="max-w-xs truncate">
                      {r[i] || <span className="text-stone-300">prázdne</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Checkbox
        checked={!strict}
        onChange={(e) => setStrict(!e.target.checked)}
        label="Importovať aj riadky s chybnou hodnotou niektorého poľa (chybné pole sa vynechá a zapíše do protokolu)"
      />
      {problems.map((p) => (
        <p key={p} className="text-sm text-red-700">
          {p}
        </p>
      ))}
      <ErrorMessage error={error} />
      <div className="flex gap-2">
        <Button onClick={onBack}>Späť</Button>
        <Button variant="primary" disabled={problems.length > 0 || busy} onClick={preview}>
          {busy ? 'Pripravujem náhľad…' : 'Zobraziť náhľad'}
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// 3. Náhľad
// ---------------------------------------------------------------------

const CATEGORY = {
  new: { label: 'Nový', tone: 'success' },
  match: { label: 'Zhoda', tone: 'warning' },
  error: { label: 'Chyba', tone: 'danger' },
}

function PersonCells({ person }) {
  return (
    <>
      <td className="py-1.5 pr-3 font-medium">{`${person.first_name} ${person.last_name}`.trim() || '—'}</td>
      <td className="py-1.5 pr-3 text-stone-600">{person.birth_date || ''}{person.birth_date_approx ? ' (približne)' : ''}</td>
      <td className="py-1.5 pr-3 text-stone-600">{person.city || ''}</td>
    </>
  )
}

function PreviewStep({ preview, onBack, onNext }) {
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const { summary } = preview
  const rows = useMemo(
    () => preview.rows.filter((r) => (filter === 'all' ? true : filter === 'warnings' ? r.warnings.length > 0 : r.category === filter)),
    [preview.rows, filter],
  )
  const tabs = [
    ['all', `Všetky (${summary.total})`],
    ['new', `Nové (${summary.new})`],
    ['match', `Zhoda s existujúcim (${summary.match})`],
    ['error', `Chyby (${summary.error})`],
    ['warnings', `S upozornením (${summary.warnings})`],
  ]

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Riadkov v súbore" value={summary.total} />
        <Stat label="Nové profily" value={summary.new} tone="text-emerald-700" />
        <Stat label="Zhoda s existujúcim" value={summary.match} tone="text-amber-700" />
        <Stat label="Chybné riadky" value={summary.error} tone="text-red-700" />
      </div>
      <p className="text-xs text-stone-500">
        Porovnané s {preview.existingCount.toLocaleString('sk-SK')} existujúcimi profilmi za {preview.durationMs} ms. Zhoda sa hľadá podľa
        pôvodného čísla, potom podľa mena a dátumu narodenia, potom podľa telefónu alebo e-mailu. Rovnaké meno bez zhody dátumu nie je
        duplicita.
      </p>

      <div className="flex flex-wrap gap-1">
        {tabs.map(([key, label]) => (
          <Button key={key} size="sm" variant={filter === key ? 'primary' : 'ghost'} onClick={() => { setFilter(key); setLimit(PAGE) }}>
            {label}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2 pr-3 font-medium">Riadok</th>
              <th className="py-2 pr-3 font-medium">Stav</th>
              <th className="py-2 pr-3 font-medium">Meno</th>
              <th className="py-2 pr-3 font-medium">Narodenie</th>
              <th className="py-2 pr-3 font-medium">Mesto</th>
              <th className="py-2 font-medium">Podrobnosti</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.rowNumber} className="border-b border-stone-100 align-top">
                <td className="py-1.5 pr-3 text-stone-500">{r.rowNumber}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={CATEGORY[r.category].tone}>{CATEGORY[r.category].label}</Badge>
                </td>
                <PersonCells person={r.person} />
                <td className="py-1.5 text-xs">
                  {r.errors.map((e) => <div key={e} className="text-red-700">{e}</div>)}
                  {r.match && (
                    <div className="text-amber-800">
                      {r.match.candidates.map((c) => `#${c.id} ${c.first_name} ${c.last_name}`).join(', ')}: {r.match.reason}
                    </div>
                  )}
                  {r.warnings.map((w) => <div key={w} className="text-stone-500">{w}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title="V tejto kategórii nie sú žiadne riadky." />}
        {rows.length > limit && (
          <div className="mt-3">
            <Button size="sm" onClick={() => setLimit(limit + PAGE * 5)}>
              Zobraziť ďalšie ({rows.length - limit})
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={onBack}>Späť na stĺpce</Button>
        <Button variant="primary" disabled={summary.new + summary.match === 0} onClick={onNext}>
          Pokračovať na rozhodnutie o duplicitách
        </Button>
      </div>
    </Card>
  )
}

function Stat({ label, value, tone = 'text-stone-900' }) {
  return (
    <div className="rounded-lg border border-stone-200 px-3 py-2">
      <div className={cx('text-2xl font-semibold', tone)}>{value.toLocaleString('sk-SK')}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------
// 4. Duplicity a vykonanie
// ---------------------------------------------------------------------

const ACTION_OPTIONS = [
  { value: DUPLICATE_ACTIONS.SKIP, label: 'Preskočiť' },
  { value: DUPLICATE_ACTIONS.UPDATE, label: 'Aktualizovať existujúci profil' },
  { value: DUPLICATE_ACTIONS.CREATE, label: 'Založiť ako nový profil' },
]

// Riadok bez jednoznačnej silnej zhody (len telefón/e-mail, alebo viac profilov)
// sa nikdy neriadi hromadným rozhodnutím — predvolene sa preskočí.
function needsManual(row) {
  return !isStrongMatch(row.match) || row.match.personId == null
}

// Rozhodnutie pre riadok so zhodou: { action, personId }
function decisionFor(row, defaultAction, overrides) {
  const o = overrides[row.rowNumber]
  if (o) return o
  if (needsManual(row)) return { action: DUPLICATE_ACTIONS.SKIP, personId: null }
  return { action: defaultAction, personId: row.match.personId }
}

function rowOptions(row) {
  if (!needsManual(row)) return ACTION_OPTIONS
  return [
    { value: DUPLICATE_ACTIONS.SKIP, label: 'Preskočiť' },
    ...row.match.candidates.map((c) => ({
      value: `${DUPLICATE_ACTIONS.UPDATE}:${c.id}`,
      label: `Aktualizovať #${c.id} ${c.first_name} ${c.last_name}`,
    })),
    { value: DUPLICATE_ACTIONS.CREATE, label: 'Založiť ako nový profil' },
  ]
}

function decisionValue(row, decision) {
  if (needsManual(row) && decision.action === DUPLICATE_ACTIONS.UPDATE) return `${DUPLICATE_ACTIONS.UPDATE}:${decision.personId}`
  return decision.action
}

function parseDecision(row, value) {
  const [action, id] = value.split(':')
  if (action === DUPLICATE_ACTIONS.UPDATE) return { action, personId: id ? Number(id) : row.match.personId }
  return { action, personId: null }
}

function Compare({ row }) {
  const p = row.person
  const fields = [
    ['Meno', (x) => `${x.first_name || ''} ${x.last_name || ''}`.trim()],
    ['Narodenie', (x) => x.birth_date || ''],
    ['Telefón', (x) => x.phone || ''],
    ['E-mail', (x) => x.email || ''],
  ]
  return (
    <table className="mt-1 w-full text-xs">
      <thead>
        <tr className="text-left text-stone-500">
          <th className="pr-2 font-medium" />
          <th className="pr-2 font-medium">Zo súboru</th>
          {row.match.candidates.map((c) => (
            <th key={c.id} className="pr-2 font-medium">Profil #{c.id}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fields.map(([label, get]) => (
          <tr key={label}>
            <td className="pr-2 text-stone-500">{label}</td>
            <td className="pr-2">{get(p) || '—'}</td>
            {row.match.candidates.map((c) => (
              <td key={c.id} className={cx('pr-2', get(c) && get(p) && get(c) !== get(p) && 'font-semibold text-red-700')}>
                {get(c) || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DuplicatesStep({ preview, registration, defaultAction, setDefaultAction, overrides, setOverrides, onBack, onDone }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [limit, setLimit] = useState(PAGE)

  const matches = preview.rows.filter((r) => r.category === 'match')
  const strongCount = matches.filter((r) => !needsManual(r)).length
  const manualCount = matches.length - strongCount
  const plan = preview.rows
    .filter((r) => r.category !== 'error')
    .map((row) =>
      row.category === 'new'
        ? { row, action: DUPLICATE_ACTIONS.CREATE, personId: null }
        : { row, ...decisionFor(row, defaultAction, overrides) },
    )
  const counts = {
    create: plan.filter((p) => p.action === DUPLICATE_ACTIONS.CREATE).length,
    update: plan.filter((p) => p.action === DUPLICATE_ACTIONS.UPDATE).length,
    skip: plan.filter((p) => p.action === DUPLICATE_ACTIONS.SKIP).length,
  }

  async function run() {
    setError(null)
    setProgress({ done: 0, total: plan.length })
    let createdWaveId = null
    try {
      let registrationId = null
      if (registration.mode === 'existing') registrationId = Number(registration.id)
      if (registration.mode === 'new') {
        createdWaveId = (await createRegistration({ name: registration.name })).id
        registrationId = createdWaveId
      }
      const result = await executeImport({
        plan,
        errorRows: preview.rows.filter((r) => r.category === 'error'),
        registrationId,
        onProgress: setProgress,
      })
      const linked = result.protocol.some((p) => p.outcome === 'created' || p.outcome === 'updated')
      // Nová vlna, do ktorej sa nikto nepriradil, nesmie zostať visieť.
      if (createdWaveId && (!linked || result.warnings.length)) await deleteRegistration(createdWaveId).catch(() => {})
      await queryClient.invalidateQueries({ queryKey: PEOPLE_LIST_KEY })
      await queryClient.invalidateQueries({ queryKey: REGISTRATIONS_ALL_KEY })
      toast.show({ message: result.warnings.length ? 'Import dokončený s upozornením.' : 'Import dokončený.', tone: result.warnings.length ? 'info' : 'success' })
      onDone(result)
    } catch (err) {
      if (createdWaveId) await deleteRegistration(createdWaveId).catch(() => {})
      setError(err)
      setProgress(null)
    }
  }

  const running = progress !== null

  return (
    <Card className="flex flex-col gap-4 p-5">
      {matches.length > 0 ? (
        <>
          {strongCount > 0 && (
            <Field label={`Hromadné rozhodnutie pre ${countLabel(strongCount, 'jednoznačnú zhodu', 'jednoznačné zhody', 'jednoznačných zhôd')} (pôvodné číslo alebo meno + dátum narodenia)`}>
              <Select className="max-w-sm" value={defaultAction} onChange={(e) => setDefaultAction(e.target.value)} options={ACTION_OPTIONS} disabled={running} />
            </Field>
          )}
          {manualCount > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {countLabel(manualCount, 'riadok má', 'riadky majú', 'riadkov má')} len možnú zhodu (rovnaký telefón či e-mail — často rodina)
              alebo zhodu s viacerými profilmi. Tieto sa predvolene preskočia; aktualizovať ich môžete len ručne pri riadku po porovnaní
              údajov. Meno a dátum narodenia sa pri možnej zhode nikdy neprepíšu.
            </p>
          )}
          <p className="text-xs text-stone-500">
            Aktualizácia prepíše len polia, ktoré majú v súbore hodnotu — prázdne bunky existujúce údaje nezmenia.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2 pr-3 font-medium">Riadok</th>
                  <th className="py-2 pr-3 font-medium">Zo súboru</th>
                  <th className="py-2 pr-3 font-medium">Zhoda</th>
                  <th className="py-2 font-medium">Akcia</th>
                </tr>
              </thead>
              <tbody>
                {matches.slice(0, limit).map((r) => {
                  const decision = decisionFor(r, defaultAction, overrides)
                  return (
                    <tr key={r.rowNumber} className="border-b border-stone-100 align-top">
                      <td className="py-1.5 pr-3 text-stone-500">{r.rowNumber}</td>
                      <td className="py-1.5 pr-3">
                        <div className="font-medium">{`${r.person.first_name} ${r.person.last_name}`.trim()}</div>
                        <div className="text-xs text-stone-500">{[r.person.birth_date, r.person.city].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="py-1.5 pr-3 text-xs">
                        <Badge tone={needsManual(r) ? 'danger' : 'warning'}>{needsManual(r) ? 'rozhodnite ručne' : 'jednoznačná'}</Badge>
                        <div className="mt-1 text-amber-800">{r.match.reason}</div>
                        {needsManual(r) && <Compare row={r} />}
                        {!needsManual(r) && (
                          <div className="text-stone-600">
                            #{r.match.candidates[0].id} {r.match.candidates[0].first_name} {r.match.candidates[0].last_name}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5">
                        <Select
                          value={decisionValue(r, decision)}
                          disabled={running}
                          onChange={(e) => setOverrides({ ...overrides, [r.rowNumber]: parseDecision(r, e.target.value) })}
                          options={rowOptions(r)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {matches.length > limit && (
              <Button size="sm" className="mt-3" onClick={() => setLimit(limit + PAGE * 5)}>
                Zobraziť ďalšie ({matches.length - limit})
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-stone-600">Žiadny riadok sa nezhoduje s existujúcim profilom.</p>
      )}

      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm">
        <p className="mb-2 font-medium">Čo sa stane po potvrdení:</p>
        <ul className="list-inside list-disc space-y-0.5 text-stone-700">
          <li>vznikne {countLabel(counts.create, 'nový profil', 'nové profily', 'nových profilov')}</li>
          <li>{countLabel(counts.update, 'profil sa aktualizuje', 'profily sa aktualizujú', 'profilov sa aktualizuje')}</li>
          <li>{countLabel(counts.skip, 'riadok sa preskočí', 'riadky sa preskočia', 'riadkov sa preskočí')}</li>
          <li>{countLabel(preview.summary.error, 'chybný riadok sa neprevezme', 'chybné riadky sa neprevezmú', 'chybných riadkov sa neprevezme')} (budú v protokole aj s dôvodom)</li>
          <li>
            {registration.mode === 'none'
              ? 'ľudia sa nepriradia k žiadnej registračnej vlne'
              : registration.mode === 'new'
                ? `ľudia sa priradia k novej vlne „${registration.name}"`
                : 'ľudia sa priradia k vybranej registračnej vlne'}
          </li>
        </ul>
      </div>

      <Checkbox checked={confirmed} disabled={running} onChange={(e) => setConfirmed(e.target.checked)} label="Skontroloval(a) som náhľad a chcem import vykonať." />
      {running && (
        <div className="flex flex-col gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full bg-stone-900 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
          </div>
          <span className="text-xs text-stone-500">
            Spracované {progress.done} z {progress.total}…
          </span>
        </div>
      )}
      <ErrorMessage error={error} />
      <div className="flex gap-2">
        <Button onClick={onBack} disabled={running}>Späť na náhľad</Button>
        <Button variant="primary" disabled={!confirmed || running || plan.length === 0} onClick={run}>
          {running ? 'Importujem…' : `Vykonať import (${counts.create + counts.update})`}
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// 5. Protokol
// ---------------------------------------------------------------------

function ResultStep({ protocol, warnings = [], fileName, onNew }) {
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const counts = protocol.reduce((acc, p) => ({ ...acc, [p.outcome]: (acc[p.outcome] || 0) + 1 }), {})
  const rows = filter === 'all' ? protocol : protocol.filter((p) => p.outcome === filter)

  function download() {
    const blob = new Blob([protocolToCsv(protocol)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `protokol-importu-${(fileName || 'subor').replace(/\.[^.]+$/, '')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const tones = { created: 'success', updated: 'info', skipped: 'neutral', error: 'danger' }

  return (
    <Card className="flex flex-col gap-4 p-5">
      {warnings.map((w) => (
        <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          {w}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Vytvorené" value={counts.created || 0} tone="text-emerald-700" />
        <Stat label="Aktualizované" value={counts.updated || 0} tone="text-sky-700" />
        <Stat label="Preskočené" value={counts.skipped || 0} />
        <Stat label="Neprešli" value={counts.error || 0} tone="text-red-700" />
      </div>
      <div className="flex flex-wrap gap-1">
        {['all', 'created', 'updated', 'skipped', 'error'].map((k) => (
          <Button key={k} size="sm" variant={filter === k ? 'primary' : 'ghost'} onClick={() => { setFilter(k); setLimit(PAGE) }}>
            {k === 'all' ? 'Všetky' : OUTCOME_LABELS[k]} ({k === 'all' ? protocol.length : counts[k] || 0})
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2 pr-3 font-medium">Riadok</th>
              <th className="py-2 pr-3 font-medium">Meno</th>
              <th className="py-2 pr-3 font-medium">Výsledok</th>
              <th className="py-2 pr-3 font-medium">Profil</th>
              <th className="py-2 font-medium">Dôvod</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => (
              <tr key={`${p.rowNumber}-${p.outcome}`} className="border-b border-stone-100 align-top">
                <td className="py-1.5 pr-3 text-stone-500">{p.rowNumber}</td>
                <td className="py-1.5 pr-3">{p.name || '—'}</td>
                <td className="py-1.5 pr-3"><Badge tone={tones[p.outcome]}>{OUTCOME_LABELS[p.outcome]}</Badge></td>
                <td className="py-1.5 pr-3 text-stone-500">{p.personId ? `#${p.personId}` : ''}</td>
                <td className="py-1.5 text-xs text-stone-600">{p.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <Button size="sm" className="mt-3" onClick={() => setLimit(limit + PAGE * 5)}>
            Zobraziť ďalšie ({rows.length - limit})
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={download}>Stiahnuť protokol (CSV)</Button>
        <Button onClick={onNew}>Nový import</Button>
      </div>
    </Card>
  )
}
