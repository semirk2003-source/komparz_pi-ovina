import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { anonymizePerson } from '../../api/people.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { Button, ErrorMessage, Field, Input, Modal } from '../../components/ui.jsx'
import { fullName } from '../../lib/format.js'
import { useInvalidatePerson } from './hooks.js'
import { useStorageCleanup } from './useStorageCleanup.js'

const CONFIRM_WORD = 'ANONYMIZOVAŤ'

// UC-16: vybavenie žiadosti o výmaz. Dvojité potvrdenie — zaškrtnutie a prepísanie slova.
export function AnonymizeDialog({ person, onClose, onDone }) {
  const [understood, setUnderstood] = useState(false)
  const [typed, setTyped] = useState('')
  const invalidate = useInvalidatePerson()
  const toast = useToast()
  const reportCleanup = useStorageCleanup()

  const mutation = useMutation({
    mutationFn: () => anonymizePerson(person.id),
    onSuccess: async (result) => {
      await invalidate(person.id)
      toast.show({ message: 'Profil bol anonymizovaný.', tone: 'success' })
      reportCleanup(result?.failedFiles)
      onDone()
    },
  })

  const ready = understood && typed.trim().toUpperCase() === CONFIRM_WORD

  return (
    <Modal
      open
      onClose={onClose}
      title="Anonymizovať profil"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Zrušiť</Button>
          <Button variant="danger" disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Anonymizujem…' : 'Natrvalo anonymizovať'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-stone-700">
        <p>
          Profil <strong>{fullName(person)}</strong> (ID {person.id}) sa anonymizuje. Natrvalo zmiznú kontakty, adresa, dátum
          narodenia, telesné údaje, poznámky, všetky fotografie a človek sa odstráni z výberov. Záznamy o účinkovaní v archíve zostanú pod anonymným profilom, aby v histórii
          projektov nevznikli diery.
        </p>
        <p className="font-medium text-red-800">Tento krok sa nedá vrátiť.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-700" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          Rozumiem, že ide o žiadosť o výmaz údajov a že sa to nedá vrátiť.
        </label>
        <Field label={`Pre potvrdenie napíšte ${CONFIRM_WORD}`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        <ErrorMessage error={mutation.error} />
      </div>
    </Modal>
  )
}
