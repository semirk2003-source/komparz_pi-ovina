import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, Card, EmptyState, ErrorMessage, Field, Input, Modal, PageHeader, Select, Spinner, Textarea,
} from '../../components/ui.jsx'
import { useToast } from '../../components/toast/ToastContext.js'
import { useAuth } from '../../auth/AuthContext.js'
import { cx } from '../../lib/cx.js'
import { formatDate } from '../../lib/format.js'
import { IS_DEMO } from '../../api/backend.js'
import { resetDemoDb } from '../../api/local/db.js'
import { ROLES, ROLE_LABELS } from '../../constants/polia.js'
import {
  createRegistration, deleteRegistration, getSystemStats, inviteUser, listRegistrations, listUsers,
  setUserActive, setUserRole, updateRegistration,
} from '../../api/admin.js'
import { REGISTRATIONS_ALL_KEY, REGISTRATIONS_KEY, SYSTEM_STATS_KEY, USERS_KEY } from './queryKeys.js'

const TABS = [
  ['users', 'Používatelia'],
  ['registrations', 'Registračné vlny'],
  ['system', 'Systém'],
]

const ROLE_OPTIONS = Object.values(ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

export function SettingsPage() {
  const [tab, setTab] = useState('users')
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Nastavenia" subtitle="Používatelia a ich práva, registračné vlny a stav systému." />
      <div className="flex flex-wrap gap-1 border-b border-stone-200" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'registrations' && <RegistrationsTab />}
      {tab === 'system' && <SystemTab />}
    </div>
  )
}

// ---------------------------------------------------------------------
// Používatelia
// ---------------------------------------------------------------------

function UsersTab() {
  const { user: me, refresh } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: users = [], isLoading, error, refetch } = useQuery({ queryKey: USERS_KEY, queryFn: listUsers })
  const [inviteOpen, setInviteOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: ({ kind, id, value }) => (kind === 'role' ? setUserRole(id, value) : setUserActive(id, value)),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY })
      if (vars.id === me.id) refresh()
      toast.show({
        message: vars.kind === 'role' ? 'Rola bola zmenená.' : vars.value ? 'Prístup bol obnovený.' : 'Prístup bol odobratý. Výbery používateľa zostávajú tímu.',
        tone: 'success',
      })
    },
    onError: (err) => toast.error(err),
  })

  function revoke(u) {
    if (window.confirm(`Odobrať prístup používateľovi ${u.full_name || u.email}? Jeho výbery a záznamy zostanú zachované.`)) {
      mutation.mutate({ kind: 'active', id: u.id, value: false })
    }
  }

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} onRetry={refetch} />

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          Správca vidí a nastavuje všetko, castingový pracovník číta, upravuje a exportuje, prizeraný len číta bez kontaktov a bez exportu.
        </p>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          Pozvať používateľa
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2 pr-3 font-medium">Meno</th>
              <th className="py-2 pr-3 font-medium">E-mail</th>
              <th className="py-2 pr-3 font-medium">Rola</th>
              <th className="py-2 pr-3 font-medium">Stav</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-stone-100">
                <td className="py-2 pr-3 font-medium">
                  {u.full_name || '—'} {u.id === me.id && <span className="text-xs text-stone-500">(vy)</span>}
                </td>
                <td className="py-2 pr-3 text-stone-600">{u.email}</td>
                <td className="py-2 pr-3">
                  <Select
                    value={u.role}
                    disabled={mutation.isPending}
                    onChange={(e) => mutation.mutate({ kind: 'role', id: u.id, value: e.target.value })}
                    options={ROLE_OPTIONS}
                    className="min-w-48"
                  />
                </td>
                <td className="py-2 pr-3">
                  {u.is_active ? <Badge tone="success">aktívny</Badge> : <Badge tone="neutral">bez prístupu</Badge>}
                </td>
                <td className="py-2 text-right">
                  {u.is_active ? (
                    <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => revoke(u)}>
                      Odobrať prístup
                    </Button>
                  ) : (
                    <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: 'active', id: u.id, value: true })}>
                      Aktivovať prístup
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Card>
  )
}

function InviteModal({ open, onClose }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ email: '', full_name: '', role: ROLES.CASTER })
  const mutation = useMutation({
    mutationFn: inviteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY })
      toast.show({
        message: IS_DEMO ? 'Používateľ bol vytvorený (demo — e-mail sa neposiela).' : `Pozvánka odoslaná na ${form.email}.`,
        tone: 'success',
      })
      setForm({ email: '', full_name: '', role: ROLES.CASTER })
      onClose()
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pozvať používateľa"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Zrušiť</Button>
          <Button variant="primary" disabled={mutation.isPending || !form.email} onClick={() => mutation.mutate(form)}>
            {mutation.isPending ? 'Odosielam…' : 'Poslať pozvánku'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="E-mail">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
        </Field>
        <Field label="Meno (nepovinné)">
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Rola">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLE_OPTIONS} />
        </Field>
        <p className="text-xs text-stone-500">
          Používateľ dostane e-mail s odkazom na nastavenie hesla. Rolu môžete kedykoľvek zmeniť alebo prístup odobrať.
        </p>
        <ErrorMessage error={mutation.error} />
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Registračné vlny
// ---------------------------------------------------------------------

const EMPTY_REG = { name: '', period_start: '', period_end: '', note: '' }

function RegistrationsTab() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: regs = [], isLoading, error, refetch } = useQuery({ queryKey: REGISTRATIONS_KEY, queryFn: listRegistrations })
  const [editing, setEditing] = useState(null) // null | { id?, ...fields }

  const save = useMutation({
    mutationFn: ({ id, ...values }) => (id ? updateRegistration(id, values) : createRegistration(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTRATIONS_ALL_KEY })
      toast.show({ message: 'Vlna bola uložená.', tone: 'success' })
      setEditing(null)
    },
  })
  const remove = useMutation({
    mutationFn: deleteRegistration,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REGISTRATIONS_ALL_KEY })
      toast.show({ message: 'Vlna bola zmazaná.', tone: 'success' })
    },
    onError: (err) => toast.error(err),
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} onRetry={refetch} />

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">Náborové vlny, z ktorých ľudia pochádzajú. Vlnu s priradenými ľuďmi nemožno zmazať.</p>
        <Button variant="primary" onClick={() => setEditing({ ...EMPTY_REG })}>
          Nová vlna
        </Button>
      </div>
      {regs.length === 0 ? (
        <EmptyState title="Zatiaľ žiadne registračné vlny." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2 pr-3 font-medium">Názov</th>
                <th className="py-2 pr-3 font-medium">Obdobie</th>
                <th className="py-2 pr-3 font-medium">Ľudí</th>
                <th className="py-2 pr-3 font-medium">Poznámka</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {regs.map((r) => (
                <tr key={r.id} className="border-b border-stone-100">
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3 text-stone-600">
                    {formatDate(r.period_start) || '?'} – {formatDate(r.period_end) || '?'}
                  </td>
                  <td className="py-2 pr-3">{r.people_count}</td>
                  <td className="max-w-xs truncate py-2 pr-3 text-stone-600">{r.note}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ ...EMPTY_REG, ...r, period_start: r.period_start || '', period_end: r.period_end || '', note: r.note || '' })}>
                      Upraviť
                    </Button>
                    {r.people_count === 0 && (
                      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => window.confirm(`Zmazať prázdnu vlnu „${r.name}"?`) && remove.mutate(r.id)}>
                        Zmazať
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Upraviť vlnu' : 'Nová registračná vlna'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Zrušiť</Button>
            <Button
              variant="primary"
              disabled={save.isPending || !editing?.name?.trim()}
              onClick={() => save.mutate({ id: editing.id, name: editing.name, period_start: editing.period_start, period_end: editing.period_end, note: editing.note })}
            >
              Uložiť
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Field label="Názov">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Od">
                <Input type="date" value={editing.period_start} onChange={(e) => setEditing({ ...editing, period_start: e.target.value })} />
              </Field>
              <Field label="Do">
                <Input type="date" value={editing.period_end} onChange={(e) => setEditing({ ...editing, period_end: e.target.value })} />
              </Field>
            </div>
            <Field label="Poznámka">
              <Textarea value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </Field>
            <ErrorMessage error={save.error} />
          </div>
        )}
      </Modal>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Systém
// ---------------------------------------------------------------------

const MIGRATION_CHECKS = [
  ['migration_check_counts', 'Počet profilov v databáze vs. počet riadkov v dočasnej tabuľke'],
  ['migration_check_missing_birth_date', 'Profily bez dátumu narodenia'],
  ['migration_check_errors', 'Riadky, ktoré sa neprevzali, aj s dôvodom'],
  ['migration_check_suspicious_names', 'Podozrivé mená (jednoslovné alebo dlhšie ako 45 znakov)'],
  ['migration_check_same_name_birth', 'Menovci s rovnakým dátumom narodenia (možné duplicity)'],
]

function SystemTab() {
  const { data: stats, isLoading, error, refetch } = useQuery({ queryKey: SYSTEM_STATS_KEY, queryFn: getSystemStats })
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <h2 className="mb-2 font-semibold">Režim</h2>
        {IS_DEMO ? (
          <div className="flex flex-col gap-2 text-sm text-stone-700">
            <p>
              <Badge tone="warning">Demo</Badge> Aplikácia beží nad vygenerovanými dátami uloženými len v tomto prehliadači. Po založení
              Supabase doplňte <code>VITE_SUPABASE_URL</code> a <code>VITE_SUPABASE_ANON_KEY</code> do súboru <code>.env.local</code> (postup v
              README).
            </p>
            <div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => window.confirm('Obnoviť demo dáta do pôvodného stavu? Zmeny v demo režime sa stratia.') && resetDemoDb()}
              >
                Obnoviť demo dáta
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-700">
            <Badge tone="success">Supabase</Badge> Dáta sú v zdieľanej databáze. Denné zálohy a test obnovy — pozri README, časť Zálohy.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Počty záznamov</h2>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorMessage error={error} onRetry={refetch} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.table} className="rounded-lg border border-stone-200 px-3 py-2">
                <dt className="text-xs text-stone-500">{s.label}</dt>
                <dd className="text-xl font-semibold">{s.count == null ? '—' : s.count.toLocaleString('sk-SK')}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-semibold">Kontrola migrácie</h2>
        <p className="mb-3 text-sm text-stone-600">
          Po prenose dát z Excelu spustite v Supabase → SQL Editor tieto kontrolné pohľady (napr. <code>select * from staging.migration_check_counts;</code>).
          Excel prestaňte používať až keď prejde celý kontrolný zoznam z README (časť Migrácia, krok „Kontrola pred prepnutím na ostro").
        </p>
        <ul className="space-y-1 text-sm">
          {MIGRATION_CHECKS.map(([view, label]) => (
            <li key={view}>
              <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">staging.{view}</code> — {label}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
