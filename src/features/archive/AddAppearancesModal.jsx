import { Fragment, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal, Button, Field, Input, Textarea, Badge, Checkbox, ErrorMessage, Spinner } from '../../components/ui.jsx'
import { checkDuplicates, createAppearances } from '../../api/archive.js'
import { MATCH_STATUS } from '../../constants/polia.js'
import { formatDate, nameWithId, countLabel } from '../../lib/format.js'
import { suggestPeople, countNamesakes } from '../../lib/nameMatch.js'
import { PersonPicker } from './PersonPicker.jsx'
import { parsePastedRows, personHint } from './archiveUtils.js'
import { ARCHIVE_KEY } from './archiveQueries.js'
import { useToast } from '../../components/toast/ToastContext.js'

const SUGGEST_MIN = 0.75
const AUTO_PROPOSE_MIN = 0.88

function dupReason(dup, row, byId) {
  if (!dup) return null
  if (dup.exact === 'batch') {
    return row?.person_id == null
      ? 'Rovnaké meno je v zozname dvakrát s rovnakým dňom, projektom aj postavou. Ak ide o dvoch rôznych ľudí (menovcov), priraďte každému jeho profil; inak je to duplicita.'
      : 'Ten istý človek je v zozname dvakrát (dátum, projekt aj postava) — duplicita.'
  }
  if (dup.exact) return 'Už je v archíve (rovnaká osoba, dátum, projekt aj postava).'
  if (dup.sameRecord?.length) {
    const linked = dup.sameRecord
      .map((d) => (d.person_id != null ? byId?.get(d.person_id) : null))
      .filter(Boolean)
      .map((p) => nameWithId(p))
    return `Rovnaký záznam zo súpisky už je v archíve${linked.length ? ` (prepojený na ${linked.join(', ')})` : ' (nepriradený)'} — pravdepodobne duplicita.`
  }
  if (dup.sameDay.length) {
    const roles = [...new Set(dup.sameDay.map((d) => d.role_name || '—'))].join(', ')
    return `V ten deň a v tom projekte už má záznam (postava: ${roles}).`
  }
  return null
}

// UC-07: zápis odohraného nakrúcacieho dňa — jednotlivo alebo vložením súpisky.
export function AddAppearancesModal({ people, facets, onClose }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState('input')
  const [common, setCommon] = useState({ shoot_date: '', production_name: '', series_name: '', role_name: '' })
  const [text, setText] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [picking, setPicking] = useState(null)

  const activePeople = useMemo(() => people.filter((p) => p.is_active !== false), [people])
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const seriesOptions = facets.find((f) => f.production === common.production_name)?.series || []

  async function withDuplicates(list) {
    const candidates = list.filter((r) => !r.error)
    const dups = await checkDuplicates(candidates)
    const byIndex = new Map(candidates.map((r, i) => [r.index, dups[i]]))
    return list.map((r) => {
      const dup = byIndex.get(r.index) || null
      const blocked = !!r.error || !!dup?.exact
      const warn = !blocked && (dup?.sameDay.length > 0 || dup?.sameRecord.length > 0)
      return { ...r, dup, blocked, include: r.userInclude ?? (!blocked && !warn) }
    })
  }

  async function goPreview() {
    setError(null)
    const parsed = parsePastedRows(text, common)
    if (parsed.length === 0) {
      setError(new Error('Vložte aspoň jedno meno.'))
      return
    }
    const prepared = parsed.map((r) => {
      const alternatives = r.raw_name ? suggestPeople(r.raw_name, activePeople, { limit: 5, minScore: SUGGEST_MIN }) : []
      const top = alternatives[0]
      // Menovci (viac profilov s rovnakým menom) alebo takmer rovnaké skóre: nenavrhujeme nikoho,
      // výber nechávame na človeku.
      const ambiguous =
        !!top && ((!!alternatives[1] && top.score - alternatives[1].score < 0.02) || countNamesakes(top.person, activePeople) > 1)
      const proposed = top && !ambiguous && top.score >= AUTO_PROPOSE_MIN ? top : null
      return {
        ...r,
        alternatives,
        ambiguous,
        person_id: proposed?.person.id ?? null,
        match_score: proposed?.score ?? null,
        confirmed: false,
      }
    })
    setBusy(true)
    try {
      setRows(await withDuplicates(prepared))
      setStep('preview')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function changePerson(index, value, pickedPerson = null) {
    const personId = value ? Number(value) : null
    setPicking(null)
    const next = rows.map((r) => {
      if (r.index !== index) return r
      const alternatives =
        pickedPerson && !r.alternatives.some((a) => a.person.id === pickedPerson.id)
          ? [...r.alternatives, { person: pickedPerson, score: null }]
          : r.alternatives
      const alt = alternatives.find((a) => a.person.id === personId)
      return { ...r, alternatives, person_id: personId, match_score: alt?.score ?? null, confirmed: false, userInclude: undefined }
    })
    setBusy(true)
    try {
      setRows(await withDuplicates(next))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  function patchRow(index, patch) {
    setRows((list) => list.map((r) => (r.index === index ? { ...r, ...patch } : r)))
  }

  async function save() {
    const toSave = rows.filter((r) => r.include && !r.blocked)
    if (toSave.length === 0) {
      setError(new Error('Nie je čo uložiť — všetky riadky sú vynechané.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await createAppearances(
        toSave.map((r) => ({
          raw_name: r.raw_name,
          shoot_date: r.shoot_date,
          role_name: r.role_name,
          production_name: r.production_name,
          series_name: r.series_name,
          person_id: r.person_id,
          match_status: r.person_id == null ? MATCH_STATUS.UNMATCHED : r.confirmed ? MATCH_STATUS.CONFIRMED : MATCH_STATUS.SUGGESTED,
          match_score: r.match_score,
          source: 'súpiska',
        })),
      )
      queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY })
      const skipped = rows
        .filter((r) => !(r.include && !r.blocked))
        .map((r) => ({ name: r.raw_name || `riadok ${r.index + 1}`, reason: r.error || dupReason(r.dup, r, byId) || 'Vynechané používateľom.' }))
      setResult({ saved: saved.length, skipped })
      setStep('done')
      toast.show({ message: `Uložené: ${countLabel(saved.length, 'záznam', 'záznamy', 'záznamov')}.`, tone: 'success' })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const includedCount = rows.filter((r) => r.include && !r.blocked).length

  const footer =
    step === 'input' ? (
      <>
        <Button onClick={onClose}>Zrušiť</Button>
        <Button variant="primary" onClick={goPreview} disabled={busy}>
          Pokračovať na náhľad
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button className="mr-auto" onClick={() => setStep('input')} disabled={busy}>
          Späť
        </Button>
        <Button onClick={onClose}>Zrušiť</Button>
        <Button variant="primary" onClick={save} disabled={busy || includedCount === 0}>
          Uložiť {countLabel(includedCount, 'záznam', 'záznamy', 'záznamov')}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Zavrieť
      </Button>
    )

  return (
    <Modal open onClose={onClose} title="Pridať záznamy do archívu" size="lg" footer={footer}>
      <div className="flex flex-col gap-4">
        <ErrorMessage error={error} />

        {step === 'input' && (
          <>
            <p className="text-sm text-stone-600">
              Vyplňte spoločné údaje nakrúcacieho dňa a vložte mená zo súpisky — jedno na riadok. Ak kopírujete z Excelu,
              stĺpce môžu byť v poradí <em>meno, postava, dátum, projekt, séria</em>; prázdne stĺpce prevezmú spoločné hodnoty.
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Dátum nakrúcania">
                <Input type="date" value={common.shoot_date} onChange={(e) => setCommon((c) => ({ ...c, shoot_date: e.target.value }))} />
              </Field>
              <Field label="Projekt">
                <Input list="add-prod-list" value={common.production_name} onChange={(e) => setCommon((c) => ({ ...c, production_name: e.target.value }))} />
                <datalist id="add-prod-list">
                  {facets.map((f) => (
                    <option key={f.production} value={f.production} />
                  ))}
                </datalist>
              </Field>
              <Field label="Séria">
                <Input list="add-series-list" value={common.series_name} onChange={(e) => setCommon((c) => ({ ...c, series_name: e.target.value }))} />
                <datalist id="add-series-list">
                  {seriesOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Postava">
                <Input value={common.role_name} onChange={(e) => setCommon((c) => ({ ...c, role_name: e.target.value }))} />
              </Field>
            </div>
            <Field label="Mená zo súpisky">
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ján Novák\nMária Kováčová\n…'} />
            </Field>
            {busy && <Spinner label="Hľadám návrhy a duplicity…" />}
          </>
        )}

        {step === 'preview' && (
          <>
            <p className="text-sm text-stone-600">
              Skontrolujte návrhy prepojenia. Systém prepojenie len <strong>navrhuje</strong> — uloží sa ako „Navrhnutý", kým ho
              výslovne nepotvrdíte. Riadky, ktoré by vytvorili duplicitu, sa neuložia; pri podobných záznamoch rozhodnete vy.
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>{countLabel(rows.length, 'riadok', 'riadky', 'riadkov')}</Badge>
              <Badge tone="success">uloží sa {includedCount}</Badge>
              <Badge tone="danger">chyby / duplicity {rows.filter((r) => r.blocked).length}</Badge>
              <Badge tone="warning">na rozhodnutie {rows.filter((r) => !r.blocked && r.dup?.sameDay.length).length}</Badge>
            </div>
            <div className="overflow-auto rounded-lg border border-stone-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Uložiť</th>
                    <th className="px-3 py-2">Meno zo súpisky</th>
                    <th className="px-3 py-2">Dátum · projekt · postava</th>
                    <th className="px-3 py-2">Prepojenie na profil</th>
                    <th className="px-3 py-2">Kontrola</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => {
                    const reason = r.error || dupReason(r.dup, r, byId)
                    const person = r.person_id != null ? byId.get(r.person_id) : null
                    return (
                      <Fragment key={r.index}>
                      <tr className={r.blocked ? 'bg-red-50/50 text-stone-500' : ''}>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-stone-900"
                            checked={r.include && !r.blocked}
                            disabled={r.blocked}
                            onChange={(e) => patchRow(r.index, { include: e.target.checked, userInclude: e.target.checked })}
                            aria-label={`Uložiť ${r.raw_name}`}
                          />
                        </td>
                        <td className="px-3 py-2 align-top font-medium">{r.raw_name || '—'}</td>
                        <td className="px-3 py-2 align-top text-stone-600">
                          {r.shoot_date ? formatDate(r.shoot_date) : '—'} · {r.production_name || '—'}
                          {r.series_name ? ` (${r.series_name})` : ''} · {r.role_name || '—'}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {!r.error && (
                            <div className="flex flex-col gap-1">
                              <select
                                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
                                value={r.person_id ?? ''}
                                onChange={(e) => changePerson(r.index, e.target.value)}
                                disabled={busy}
                              >
                                <option value="">— nepriradiť —</option>
                                {r.alternatives.map((a) => (
                                  <option key={a.person.id} value={a.person.id}>
                                    {nameWithId(a.person)} · {personHint(a.person)}
                                    {a.score != null ? ` (${Math.round(a.score * 100)} %)` : ' (vybrané ručne)'}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="self-start text-xs text-sky-700 underline disabled:text-stone-400"
                                disabled={busy}
                                onClick={() => setPicking(picking === r.index ? null : r.index)}
                                aria-expanded={picking === r.index}
                              >
                                {picking === r.index ? 'Zavrieť hľadanie' : 'Hľadať iný profil…'}
                              </button>
                              {!person && r.ambiguous && (
                                <Badge tone="warning">viac profilov s podobným menom — vyberte ručne</Badge>
                              )}
                              {person && (
                                <Checkbox
                                  label="Potvrdzujem, že je to tento človek"
                                  checked={r.confirmed}
                                  onChange={(e) => patchRow(r.index, { confirmed: e.target.checked })}
                                />
                              )}
                              {person && r.ambiguous && <Badge tone="warning">pozor — viac podobných profilov</Badge>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs">
                          {reason ? <span className={r.blocked ? 'text-red-700' : 'text-amber-800'}>{reason}</span> : <span className="text-emerald-700">v poriadku</span>}
                          {!r.blocked && (r.dup?.sameDay.length > 0 || r.dup?.sameRecord.length > 0) && (
                            <div className="mt-1 text-stone-500">Zaškrtnite „Uložiť", ak ide o iný záznam.</div>
                          )}
                        </td>
                      </tr>
                      {picking === r.index && (
                        <tr>
                          <td colSpan={5} className="bg-stone-50 px-3 py-3">
                            <PersonPicker
                              rawName={r.raw_name}
                              people={activePeople}
                              selectedId={r.person_id}
                              onPick={(p) => changePerson(r.index, p.id, p)}
                            />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Uložené: <strong>{countLabel(result.saved, 'záznam', 'záznamy', 'záznamov')}</strong>. Navrhnuté prepojenia
              nájdete v archíve pod filtrom „Navrhnuté".
            </p>
            {result.skipped.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Neuložené riadky:</p>
                <ul className="list-disc pl-5 text-stone-600">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {s.name} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

