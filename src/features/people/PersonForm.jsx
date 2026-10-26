import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CLOTHING_SIZES, GENDERS, REGIONS } from '../../constants/polia.js'
import { createPerson, sanitizePersonPatch, updatePerson } from '../../api/people.js'
import { PEOPLE_LIST_KEY } from '../../hooks/usePeopleList.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { Button, Checkbox, ErrorMessage, Field, Input, Modal, Select, Textarea } from '../../components/ui.jsx'
import { useInvalidatePerson } from './hooks.js'

const FORM_ID = 'person-form'

function toFormValues(person = {}, contacts = {}) {
  const v = (x) => (x == null ? '' : String(x))
  return {
    first_name: v(person.first_name),
    last_name: v(person.last_name),
    gender: v(person.gender),
    birth_date: v(person.birth_date),
    birth_date_approx: !!person.birth_date_approx,
    phone: v(contacts?.phone),
    email: v(contacts?.email),
    address: v(contacts?.address),
    city: v(person.city),
    region: v(person.region),
    height_cm: v(person.height_cm),
    clothing_size: v(person.clothing_size),
    shoe_size: person.shoe_size == null ? '' : String(Number(person.shoe_size)),
    hair_color: v(person.hair_color),
    eye_color: v(person.eye_color),
    has_tattoos: !!person.has_tattoos,
    tattoo_note: v(person.tattoo_note),
    languages: (person.languages || []).join(', '),
    driving_licence: !!person.driving_licence,
    skills: (person.skills || []).join(', '),
    period_look: !!person.period_look,
    speaking_role: !!person.speaking_role,
    notes: v(person.notes),
    consent_at: v(person.consent_at),
    last_contacted_at: v(person.last_contacted_at),
  }
}

// Len polia, ktoré používateľ naozaj zmenil — ostatné sa na server neposielajú,
// aby sa neprepísala súbežná úprava kolegu ani hodnoty, ktoré sa nenačítali.
function changedFields(initial, values) {
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    if (!(key in initial)) continue
    const a = typeof value === 'string' ? value.trim() : value
    const b = typeof initial[key] === 'string' ? initial[key].trim() : initial[key]
    if (a !== b) out[key] = value
  }
  return out
}

// Formulár so všetkými poľami profilu. Kontakty zobrazí len ak withContacts.
function PersonForm({ initial, withContacts, onSubmit }) {
  const [values, setValues] = useState(initial)
  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setValues((v) => ({ ...v, [key]: value }))
  }

  function submit(e) {
    e.preventDefault()
    const payload = { ...values }
    if (!withContacts) {
      delete payload.phone
      delete payload.email
      delete payload.address
    }
    onSubmit(payload)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <form id={FORM_ID} onSubmit={submit} className="flex flex-col gap-5">
      <Section title="Základné údaje">
        <Field label="Meno">
          <Input value={values.first_name} onChange={set('first_name')} autoComplete="off" />
        </Field>
        <Field label="Priezvisko">
          <Input value={values.last_name} onChange={set('last_name')} autoComplete="off" />
        </Field>
        <Field label="Pohlavie">
          <Select value={values.gender} onChange={set('gender')} options={GENDERS} placeholder="— neuvedené —" />
        </Field>
        <Field label="Dátum narodenia" hint="Ukladá sa dátum, vek sa dopočíta.">
          <Input type="date" max={today} value={values.birth_date} onChange={set('birth_date')} />
        </Field>
        <Checkbox label="Dátum narodenia je len približný" checked={values.birth_date_approx} onChange={set('birth_date_approx')} />
      </Section>

      {withContacts && (
        <Section title="Kontakty">
          <Field label="Telefón">
            <Input type="tel" value={values.phone} onChange={set('phone')} placeholder="+421 9xx xxx xxx" />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={values.email} onChange={set('email')} />
          </Field>
          <Field label="Adresa" className="sm:col-span-2">
            <Input value={values.address} onChange={set('address')} />
          </Field>
        </Section>
      )}

      <Section title="Bydlisko">
        <Field label="Mesto">
          <Input value={values.city} onChange={set('city')} />
        </Field>
        <Field label="Región">
          <Select value={values.region} onChange={set('region')} options={REGIONS} placeholder="— neuvedené —" />
        </Field>
      </Section>

      <Section title="Vzhľad a veľkosti">
        <Field label="Výška (cm)">
          <Input type="number" inputMode="numeric" min={40} max={250} value={values.height_cm} onChange={set('height_cm')} />
        </Field>
        <Field label="Konfekčná veľkosť">
          <Select value={values.clothing_size} onChange={set('clothing_size')} options={CLOTHING_SIZES} placeholder="— neuvedené —" />
        </Field>
        <Field label="Veľkosť topánok">
          <Input type="number" inputMode="decimal" min={15} max={55} step={0.5} value={values.shoe_size} onChange={set('shoe_size')} />
        </Field>
        <Field label="Farba vlasov">
          <Input value={values.hair_color} onChange={set('hair_color')} />
        </Field>
        <Field label="Farba očí">
          <Input value={values.eye_color} onChange={set('eye_color')} />
        </Field>
        <div className="flex flex-col gap-2">
          <Checkbox label="Má tetovania" checked={values.has_tattoos} onChange={set('has_tattoos')} />
          {values.has_tattoos && (
            <Input placeholder="Kde / aké tetovanie" aria-label="Popis tetovania" value={values.tattoo_note} onChange={set('tattoo_note')} />
          )}
        </div>
      </Section>

      <Section title="Schopnosti">
        <Field label="Jazyky" hint="Oddeľte čiarkou, napr. angličtina, nemčina">
          <Input value={values.languages} onChange={set('languages')} />
        </Field>
        <Field label="Zručnosti" hint="Oddeľte čiarkou, napr. tanec, jazda na koni">
          <Input value={values.skills} onChange={set('skills')} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Vodičský preukaz" checked={values.driving_licence} onChange={set('driving_licence')} />
          <Checkbox label="Dobový vzhľad" checked={values.period_look} onChange={set('period_look')} />
          <Checkbox label="Textujúci (zvládne text pred kamerou)" checked={values.speaking_role} onChange={set('speaking_role')} />
        </div>
      </Section>

      <Section title="Evidencia">
        <Field label="Súhlas so spracovaním udelený">
          <Input type="date" max={today} value={values.consent_at} onChange={set('consent_at')} />
        </Field>
        <Field label="Naposledy kontaktovaný">
          <Input type="date" max={today} value={values.last_contacted_at} onChange={set('last_contacted_at')} />
        </Field>
        <Field label="Poznámky" className="sm:col-span-2">
          <Textarea value={values.notes} onChange={set('notes')} rows={4} />
        </Field>
      </Section>
    </form>
  )
}

function Section({ title, children }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold text-stone-900">{title}</legend>
      {children}
    </fieldset>
  )
}

export function EditPersonDialog({ person, contacts, withContacts, onClose }) {
  const invalidate = useInvalidatePerson()
  const toast = useToast()
  // Pôvodné hodnoty si zapamätáme raz — diff sa počíta voči tomu, čo používateľ videl.
  const [initial] = useState(() => toFormValues(person, withContacts ? contacts : {}))
  const mutation = useMutation({
    mutationFn: (values) => updatePerson(person.id, changedFields(initial, values)),
    onSuccess: async (result) => {
      await invalidate(person.id)
      toast.show({ message: result?.unchanged ? 'Žiadne zmeny na uloženie.' : 'Profil uložený.', tone: result?.unchanged ? 'info' : 'success' })
      onClose()
    },
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Upraviť profil"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Zrušiť</Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={mutation.isPending}>
            {mutation.isPending ? 'Ukladám…' : 'Uložiť'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorMessage error={mutation.error} />
        {!withContacts && (
          <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
            Kontaktné údaje sa nepodarilo načítať, preto ich teraz nemožno upraviť. Ostatné polia môžete uložiť bez obáv.
          </p>
        )}
        <PersonForm initial={initial} withContacts={withContacts} onSubmit={mutation.mutate} />
      </div>
    </Modal>
  )
}

export function CreatePersonDialog({ onClose }) {
  const queryClient = useQueryClient()
  const openProfile = useOpenProfile()
  const toast = useToast()
  const [validationError, setValidationError] = useState(null)
  const mutation = useMutation({
    mutationFn: (values) => createPerson(values),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: PEOPLE_LIST_KEY })
      toast.show({ message: 'Profil vytvorený.', tone: 'success' })
      onClose()
      openProfile(id)
    },
  })

  function submit(values) {
    setValidationError(null)
    try {
      sanitizePersonPatch(values, { requireNames: true })
    } catch (err) {
      setValidationError(err)
      return
    }
    mutation.mutate(values)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nový profil"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Zrušiť</Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={mutation.isPending}>
            {mutation.isPending ? 'Ukladám…' : 'Vytvoriť profil'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorMessage error={validationError || mutation.error} />
        <PersonForm initial={toFormValues({ consent_at: new Date().toISOString().slice(0, 10) })} withContacts onSubmit={submit} />
        <p className="text-xs text-stone-500">Fotografie pridáte po vytvorení profilu v jeho detaile.</p>
      </div>
    </Modal>
  )
}
