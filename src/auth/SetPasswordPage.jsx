import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updatePassword } from '../api/auth.js'
import { Button, Field, Input, ErrorMessage } from '../components/ui.jsx'

const MIN_LENGTH = 10

// Cieľ odkazu z e-mailu (obnova hesla aj pozvánka nového používateľa).
export function SetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) {
      setError(new Error(`Heslo musí mať aspoň ${MIN_LENGTH} znakov.`))
      return
    }
    if (password !== again) {
      setError(new Error('Heslá sa nezhodujú.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updatePassword(password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-stone-900">Nastavenie hesla</h1>
        <Field label="Nové heslo" hint={`Aspoň ${MIN_LENGTH} znakov.`}>
          <Input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Nové heslo znova">
          <Input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
        <ErrorMessage error={error} />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Ukladám…' : 'Uložiť heslo'}
        </Button>
      </form>
    </div>
  )
}
