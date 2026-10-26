import { useMemo, useState } from 'react'
import { usePermissions } from '../../auth/AuthContext.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { Badge, Button, Checkbox, ErrorMessage, Field, Input, Modal, Select } from '../../components/ui.jsx'
import { cx } from '../../lib/cx.js'
import { EXPORT_LARGE_THRESHOLD } from '../../constants/polia.js'
import { COLUMNS, CONTACT_EXPORT_COLUMNS, FULL_EXPORT_COLUMNS, allowedColumns, cellText } from '../selections/columns.js'
import { cardLines, copyToClipboard, downloadCsv, downloadPptx, downloadXlsx, printPdf, safeFileName } from './exportFiles.js'

const GROUPS = [
  { key: 'visual', label: 'Pre réžiu a klienta', hint: 'Fotky, základné údaje a poznámky castingu.' },
  { key: 'table', label: 'Pre produkciu', hint: 'Tabuľka na zmluvy, dopravu a stravu.' },
  { key: 'contact', label: 'Pre komunikáciu', hint: 'Kontakty na hromadné oslovenie.' },
]

const PART_SIZE = 40

/**
 * rows — riadky z useSelectionRows (už zoradené/odfiltrované, prípadne len označené)
 * tableColumns — stĺpce aktuálneho pohľadu tabuľky
 */
export function ExportDialog({ onClose, rows, tableColumns, viewLabel, meta, contactsLoading, contactsError, statsLoading, statsError }) {
  const permissions = usePermissions()
  const toast = useToast()
  const [group, setGroup] = useState('visual')
  const [title, setTitle] = useState(meta?.project_name || meta?.name || '')
  const [subtitle, setSubtitle] = useState(meta?.subtitle || (meta?.project_name ? meta?.name : '') || '')
  const [showContacts, setShowContacts] = useState(false)
  const [perSlide, setPerSlide] = useState(4)
  const [tableScope, setTableScope] = useState('view') // 'view' | 'full'
  const [part, setPart] = useState(0)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(null)

  const isLarge = rows.length > EXPORT_LARGE_THRESHOLD
  const parts = Math.ceil(rows.length / PART_SIZE)
  const [split, setSplit] = useState(isLarge)
  const visualRows = useMemo(
    () => (split && isLarge ? rows.slice(part * PART_SIZE, (part + 1) * PART_SIZE) : rows),
    [rows, split, isLarge, part],
  )
  const partSuffix = split && isLarge ? ` (časť ${part + 1} z ${parts})` : ''

  // Viewer sem nemá prístup — dialóg sa mu vôbec neotvorí, ale pre istotu.
  if (!permissions.canExport) return null

  // Export nesmie vzniknúť z neúplných údajov (0 nakrúcacích dní, CSV bez kontaktov).
  // Vráti dôvod, prečo sa export zatiaľ nedá spustiť, alebo null.
  function blockReason({ contacts = false, stats = false } = {}) {
    if (rows.length === 0) return 'Nie je čo exportovať — výber alebo filter je prázdny.'
    const needContacts = contacts && permissions.canSeeContacts
    if (needContacts && contactsError) return 'Kontakty sa nepodarilo načítať, export by bol neúplný.'
    if (stats && statsError) return 'Údaje o účinkovaní sa nepodarilo načítať, export by bol neúplný.'
    if (needContacts && contactsLoading) return 'Načítavam kontakty…'
    if (stats && statsLoading) return 'Načítavam údaje o účinkovaní…'
    return null
  }

  const tableCols = tableScope === 'full' ? FULL_EXPORT_COLUMNS : tableColumns
  const visualBlock = blockReason({ contacts: showContacts })
  const tableBlock = blockReason({
    contacts: tableCols.some((k) => COLUMNS[k]?.contact),
    stats: tableCols.some((k) => COLUMNS[k]?.stats),
  })
  const contactBlock = blockReason({ contacts: true })
  const namesBlock = blockReason()
  const fileBase = `${meta?.name || 'vyber'}${tableScope === 'full' ? '-kompletny' : `-${viewLabel || ''}`}`

  async function run(label, fn) {
    setBusy(label)
    setProgress(null)
    const started = performance.now()
    try {
      const result = await fn()
      const secs = ((performance.now() - started) / 1000).toFixed(1)
      if (result?.message) toast.show({ message: result.message, tone: 'success' })
      else toast.show({ message: `${label} hotové (${secs} s).`, tone: 'success' })
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  const onProgress = (done, total) => setProgress({ done, total })
  const visualOpts = { title, subtitle: subtitle + partSuffix, showContacts, perSlide }

  return (
    <Modal open onClose={onClose} title="Export výberu" size="lg" footer={<Button onClick={onClose}>Zavrieť</Button>}>
      <div className="mb-4 grid gap-2 sm:grid-cols-3" role="tablist">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={group === g.key}
            onClick={() => setGroup(g.key)}
            className={cx('rounded-xl border px-4 py-3 text-left', group === g.key ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white hover:border-stone-400')}
          >
            <div className="font-semibold">{g.label}</div>
            <div className={cx('text-xs', group === g.key ? 'text-stone-300' : 'text-stone-500')}>{g.hint}</div>
          </button>
        ))}
      </div>

      {permissions.canSeeContacts && <ErrorMessage error={contactsError} />}
      <ErrorMessage error={statsError} />
      <p className="mb-3 text-sm text-stone-600">
        Exportuje sa <strong>{rows.length}</strong> {rows.length === 1 ? 'osoba' : rows.length < 5 ? 'osoby' : 'osôb'} (podľa aktuálneho filtra a označenia v tabuľke).
      </p>

      {group === 'visual' && (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="flex flex-col gap-3">
            <Field label="Názov projektu">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Podnadpis">
              <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            </Field>
            {permissions.canSeeContacts && (
              <Checkbox label="Zobraziť kontakty (pre réžiu spravidla nie)" checked={showContacts} onChange={(e) => setShowContacts(e.target.checked)} />
            )}
            <Field label="PPTX — osôb na snímku">
              <Select value={perSlide} onChange={(e) => setPerSlide(Number(e.target.value))} options={[1, 2, 4, 6].map((n) => ({ value: n, label: String(n) }))} />
            </Field>
            {isLarge && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Veľký výber ({rows.length} profilov)</p>
                <p className="mb-2">Súbor s fotkami bude veľký a pomalý. Odporúčame ho rozdeliť na časti po {PART_SIZE}.</p>
                <Checkbox label={`Rozdeliť na ${parts} častí`} checked={split} onChange={(e) => setSplit(e.target.checked)} />
                {split && (
                  <Select
                    className="mt-2"
                    value={part}
                    onChange={(e) => setPart(Number(e.target.value))}
                    options={Array.from({ length: parts }, (_, i) => ({
                      value: i,
                      label: `Časť ${i + 1}: osoby ${i * PART_SIZE + 1}–${Math.min(rows.length, (i + 1) * PART_SIZE)}`,
                    }))}
                  />
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!!busy || !!visualBlock} onClick={() => run('PDF', () => printPdf(visualRows, permissions, visualOpts, onProgress))}>
                {busy === 'PDF' ? 'Pripravujem…' : 'PDF / tlač'}
              </Button>
              <Button
                variant="primary"
                disabled={!!busy || !!visualBlock}
                onClick={() => run('PPTX', () => downloadPptx(visualRows, permissions, visualOpts, safeFileName(`${meta?.name || 'vyber'}${split && isLarge ? `-cast-${part + 1}` : ''}`, 'pptx'), onProgress))}
              >
                {busy === 'PPTX' ? 'Pripravujem…' : 'PPTX prezentácia'}
              </Button>
            </div>
            {visualBlock && <p className="text-sm text-amber-800">{visualBlock}</p>}
            {progress && <Progress {...progress} />}
          </div>
          <VisualPreview rows={visualRows} title={title} subtitle={subtitle + partSuffix} showContacts={showContacts && permissions.canSeeContacts} />
        </div>
      )}

      {group === 'table' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Rozsah stĺpcov" className="w-72">
              <Select
                value={tableScope}
                onChange={(e) => setTableScope(e.target.value)}
                options={[
                  { value: 'view', label: `Aktuálny pohľad: ${viewLabel} (${tableColumns.length} stĺpcov)` },
                  { value: 'full', label: 'Kompletný — všetky údaje' },
                ]}
              />
            </Field>
            <Button variant="primary" disabled={!!busy || !!tableBlock} onClick={() => run('XLSX', () => downloadXlsx(rows, tableCols, permissions, safeFileName(fileBase, 'xlsx'), meta?.name || 'Výber'))}>
              Stiahnuť XLSX
            </Button>
            <Button disabled={!!busy || !!tableBlock} onClick={() => run('CSV', () => downloadCsv(rows, tableCols, permissions, safeFileName(fileBase, 'csv')))}>
              Stiahnuť CSV
            </Button>
          </div>
          {tableBlock && <p className="text-sm text-amber-800">{tableBlock}</p>}
          <p className="text-xs text-stone-500">CSV je v kódovaní UTF-8 s oddeľovačom bodkočiarka — otvorí sa priamo v slovenskom Exceli aj s diakritikou.</p>
          <TablePreview rows={rows} columns={allowedColumns(tableCols, permissions.canSeeContacts)} />
        </div>
      )}

      {group === 'contact' && (
        <ContactActions rows={rows} permissions={permissions} busy={busy} run={run} fileBase={meta?.name || 'vyber'} contactBlock={contactBlock} namesBlock={namesBlock} />
      )}
    </Modal>
  )
}

function Progress({ done, total }) {
  return (
    <div className="text-xs text-stone-600">
      Načítavam fotky {done}/{total}
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-stone-200">
        <div className="h-full bg-stone-800 transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
    </div>
  )
}

function VisualPreview({ rows, title, subtitle, showContacts }) {
  const sample = rows.slice(0, 8)
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-100 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Náhľad</p>
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-3 border-b border-stone-200 pb-2">
          <div className="font-serif text-lg font-semibold">{title || 'Výber'}</div>
          {subtitle && <div className="text-sm text-stone-600">{subtitle}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sample.map((r) => (
            <div key={r.id} className="text-[11px] leading-tight">
              <PersonPhoto path={r.person.thumb_path} alt={r.name} className="mb-1 aspect-[3/4] w-full rounded" />
              <div className="text-xs font-semibold">{r.name}</div>
              {cardLines(r, { showContacts }).map((l) => (
                <div key={l} className="text-stone-600">
                  {l}
                </div>
              ))}
              {r.note && <div className="italic text-amber-800">{r.note}</div>}
            </div>
          ))}
        </div>
        {rows.length > sample.length && <p className="mt-3 text-center text-xs text-stone-500">… a ďalších {rows.length - sample.length}</p>}
      </div>
    </div>
  )
}

function TablePreview({ rows, columns }) {
  const sample = rows.slice(0, 5)
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200">
      <p className="bg-stone-50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Náhľad (prvých {sample.length} z {rows.length} riadkov)</p>
      <table className="w-full min-w-max text-xs">
        <thead className="bg-stone-50 text-left">
          <tr>
            {columns.map((k) => (
              <th key={k} className="px-2 py-1 font-semibold">
                {COLUMNS[k].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sample.map((r) => (
            <tr key={r.id}>
              {columns.map((k) => (
                <td key={k} className="max-w-48 truncate px-2 py-1">
                  {cellText(k, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ContactActions({ rows, permissions, busy, run, fileBase, contactBlock, namesBlock }) {
  const emails = rows.filter((r) => r.email).length
  const phones = rows.filter((r) => r.phone).length

  async function copy(kind, label) {
    await run(label, async () => {
      const { copied, missing } = await copyToClipboard(kind, rows, permissions)
      return { message: `Skopírovaných ${copied}${missing ? ` (${missing} chýba)` : ''} do schránky.` }
    })
  }

  const reason = permissions.canSeeContacts ? contactBlock : namesBlock
  return (
    <div className="flex flex-col gap-4">
      {reason && <p className="text-sm text-amber-800">{reason}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <ActionCard title="Mená" detail={`${rows.length} mien, každé na riadok`}>
          <Button onClick={() => copy('names', 'Kopírovanie mien')} disabled={!!busy || !!namesBlock}>
            Kopírovať mená
          </Button>
        </ActionCard>
        {permissions.canSeeContacts && (
          <>
            <ActionCard title="E-maily" detail={`${emails} z ${rows.length}, oddelené bodkočiarkou — vložte do „Skrytá kópia"`} warn={rows.length - emails}>
              <Button onClick={() => copy('emails', 'Kopírovanie e-mailov')} disabled={!!busy || !!contactBlock || emails === 0}>
                Kopírovať e-maily
              </Button>
            </ActionCard>
            <ActionCard title="Telefóny" detail={`${phones} z ${rows.length}, každý na riadok`} warn={rows.length - phones}>
              <Button onClick={() => copy('phones', 'Kopírovanie telefónov')} disabled={!!busy || !!contactBlock || phones === 0}>
                Kopírovať telefóny
              </Button>
            </ActionCard>
          </>
        )}
      </div>
      {permissions.canSeeContacts && (
        <div>
          <Button disabled={!!busy || !!contactBlock} onClick={() => run('Kontaktné CSV', () => downloadCsv(rows, CONTACT_EXPORT_COLUMNS, permissions, safeFileName(`${fileBase}-kontakty`, 'csv')))}>
            Stiahnuť kontaktné CSV
          </Button>
          <p className="mt-1 text-xs text-stone-500">Meno, priezvisko, e-mail, telefón, mesto — na import do rozosielacieho nástroja.</p>
        </div>
      )}
    </div>
  )
}

function ActionCard({ title, detail, warn, children }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-stone-600">{detail}</div>
      {warn > 0 && <Badge tone="warning" className="self-start">{warn} bez údaja</Badge>}
      <div className="mt-auto">{children}</div>
    </div>
  )
}
