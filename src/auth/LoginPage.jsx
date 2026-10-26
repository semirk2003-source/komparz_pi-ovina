import { useState } from 'react'
import { signIn, listDemoAccounts, requestPasswordReset } from '../api/auth.js'
import { IS_DEMO } from '../api/backend.js'
import { ROLE_LABELS } from '../constants/polia.js'
import { Button, Field, Input, ErrorMessage } from '../components/ui.jsx'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    if (!email) {
      setError(new Error('Najprv vyplňte e-mail.'))
      return
    }
    try {
      await requestPasswordReset(email)
      setInfo('Ak účet existuje, poslali sme na e-mail odkaz na nastavenie nového hesla.')
    } catch (err) {
      setError(err)
    }
  }

  async function demoLogin(account) {
    setBusy(true)
    setError(null)
    try {
      await signIn(account.email, 'demo')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const demoAccounts = listDemoAccounts()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Komparz Stupák</p>
        <h1 className="mb-6 mt-1 text-center text-2xl font-semibold text-stone-900">Castingová databáza</h1>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <Field label="E-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Heslo">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorMessage error={error} />
          {info && <p className="text-sm text-emerald-700">{info}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Prihlasujem…' : 'Prihlásiť sa'}
          </Button>
          {!IS_DEMO && (
            <button type="button" onClick={forgot} className="text-sm text-stone-500 underline hover:text-stone-800">
              Zabudnuté heslo
            </button>
          )}
        </form>

        {IS_DEMO && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="mb-2 font-medium">Demo režim — prihláste sa testovacím účtom:</p>
            <div className="flex flex-col gap-2">
              {demoAccounts.map((a) => (
                <Button key={a.email} onClick={() => demoLogin(a)} disabled={busy} className="justify-between">
                  <span>{ROLE_LABELS[a.role]}</span>
                  <span className="text-xs text-stone-500">{a.email}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
