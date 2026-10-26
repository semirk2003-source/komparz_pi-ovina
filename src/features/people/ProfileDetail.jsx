import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { usePermissions } from '../../auth/AuthContext.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { Badge, Button, ErrorMessage, Modal, Spinner } from '../../components/ui.jsx'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { AddToSelectionButton } from '../selections/AddToSelectionButton.jsx'
import { Filmography } from '../archive/Filmography.jsx'
import { setPersonActive } from '../../api/people.js'
import { formatAge, formatDate, fullName, photoAgeLabel } from '../../lib/format.js'
import { cx } from '../../lib/cx.js'
import { useFavorites, useInvalidatePerson, usePersonDetail } from './hooks.js'
import { EditPersonDialog } from './PersonForm.jsx'
import { PhotoManager } from './PhotoManager.jsx'
import { PersonHistory } from './PersonHistory.jsx'
import { AnonymizeDialog } from './AnonymizeDialog.jsx'

const CHILD_AGE = 18
const STALE_CHILD_PHOTO_DAYS = 365

export function ProfileDetail({ personId }) {
  const openProfile = useOpenProfile()
  const { data, isLoading, error, refetch } = usePersonDetail(personId)
  const permissions = usePermissions()
  const [dialog, setDialog] = useState(null) // 'edit' | 'photos' | 'anonymize' | null

  const close = () => openProfile(null)
  const person = data?.person

  return (
    <Modal
      open
      // Kým je otvorené vnorené okno, Escape zatvorí len to vnorené.
      onClose={dialog ? () => {} : close}
      title={person ? fullName(person) || 'Profil' : 'Profil'}
      size="lg"
    >
      {isLoading && <Spinner label="Načítavam profil…" />}
      <ErrorMessage error={error} onRetry={refetch} />
      {data && (
        <ProfileBody
          key={personId}
          data={data}
          permissions={permissions}
          onEdit={() => setDialog('edit')}
          onPhotos={() => setDialog('photos')}
          onAnonymize={() => setDialog('anonymize')}
        />
      )}

      {data && dialog === 'edit' && (
        <EditPersonDialog
          person={data.person}
          contacts={data.contacts}
          withContacts={permissions.canSeeContacts && !!data.contacts && !data.contactsError}
          onClose={() => setDialog(null)}
        />
      )}
      {data && dialog === 'photos' && (
        <PhotoManager person={data.person} photos={data.photos} onClose={() => setDialog(null)} />
      )}
      {data && dialog === 'anonymize' && (
        <AnonymizeDialog
          person={data.person}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            close()
          }}
        />
      )}
    </Modal>
  )
}

function ProfileBody({ data, permissions, onEdit, onPhotos, onAnonymize }) {
  const { person, photos, contacts, registrations } = data
  const { ids: favoriteIds, toggle: toggleFavorite } = useFavorites()
  const invalidate = useInvalidatePerson()
  const toast = useToast()
  const favorite = favoriteIds.has(person.id)
  const anonymized = !!person.anonymized_at

  const activeMutation = useMutation({
    mutationFn: (value) => setPersonActive(person.id, value),
    onSuccess: (_d, value) => {
      invalidate(person.id)
      toast.show({ message: value ? 'Profil je znova aktívny.' : 'Profil je neaktívny — v bežnom hľadaní sa neponúka.', tone: 'success' })
    },
    onError: toast.error,
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col gap-3">
        <Gallery photos={photos} person={person} />
        {permissions.canEdit && !anonymized && (
          <Button size="sm" onClick={onPhotos}>
            Spravovať fotografie ({photos.length}/5)
          </Button>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          {person.is_active === false && <Badge tone="warning">Neaktívny profil</Badge>}
          {anonymized && <Badge tone="danger">Anonymizovaný {formatDate(person.anonymized_at)}</Badge>}
          {person.period_look && <Badge tone="info">Dobový vzhľad</Badge>}
          {person.speaking_role && <Badge tone="info">Textujúci</Badge>}
          {person.legacy_id != null && <span className="text-xs text-stone-500">Pôvodné č. {person.legacy_id}</span>}
          <span className="text-xs text-stone-500">ID {person.id}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {permissions.canEdit && !anonymized && <AddToSelectionButton personId={person.id} />}
          <Button onClick={() => toggleFavorite(person.id)} aria-pressed={favorite}>
            {favorite ? '♥ Obľúbený' : '♡ Obľúbiť'}
          </Button>
          {permissions.canEdit && !anonymized && (
            <>
              <Button onClick={onEdit}>Upraviť</Button>
              <Button
                variant="ghost"
                disabled={activeMutation.isPending}
                onClick={() => activeMutation.mutate(person.is_active === false)}
              >
                {person.is_active === false ? 'Aktivovať' : 'Deaktivovať'}
              </Button>
            </>
          )}
          {permissions.isAdmin && !anonymized && (
            <Button variant="ghost" className="text-red-700" onClick={onAnonymize}>
              Anonymizovať…
            </Button>
          )}
        </div>

        {permissions.canSeeContacts && data.contactsError && (
          <ErrorMessage error={new Error(`Kontakty sa nepodarilo načítať: ${data.contactsError.message}`)} />
        )}
        {contacts && permissions.canSeeContacts && <Contacts contacts={contacts} />}

        <Facts person={person} />

        {person.notes && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-stone-900">Poznámky</h3>
            <p className="whitespace-pre-wrap text-sm text-stone-700">{person.notes}</p>
          </section>
        )}

        {registrations.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-stone-900">Registrácie</h3>
            <ul className="flex flex-col gap-1 text-sm text-stone-700">
              {registrations.map((r) => (
                <li key={r.id}>
                  {r.name}
                  {r.responded_at && <span className="text-stone-500"> · odpovedal {formatDate(r.responded_at)}</span>}
                  {permissions.canSeeContacts && Object.keys(r.extra || {}).length > 0 && (
                    <span className="text-stone-500">
                      {' '}
                      · {Object.entries(r.extra).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-sm font-semibold text-stone-900">Filmografia</h3>
          <Filmography personId={person.id} />
        </section>

        {permissions.canEdit && <PersonHistory personId={person.id} />}
      </div>
    </div>
  )
}

function Contacts({ contacts }) {
  const phoneHref = contacts.phone ? `tel:${contacts.phone.replace(/[^\d+]/g, '')}` : null
  return (
    <section className="rounded-xl border border-stone-200 bg-stone-50 p-3">
      <h3 className="mb-2 text-sm font-semibold text-stone-900">Kontakty</h3>
      <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="text-stone-500">Telefón</dt>
        <dd>{phoneHref ? <a className="font-medium text-stone-900 underline" href={phoneHref}>{contacts.phone}</a> : <Missing />}</dd>
        <dt className="text-stone-500">E-mail</dt>
        <dd className="break-all">
          {contacts.email ? <a className="text-stone-900 underline" href={`mailto:${contacts.email}`}>{contacts.email}</a> : <Missing />}
        </dd>
        <dt className="text-stone-500">Adresa</dt>
        <dd>{contacts.address || <Missing />}</dd>
      </dl>
    </section>
  )
}

function Missing() {
  return <span className="text-amber-700">chýba</span>
}

function yesNo(v) {
  return v ? 'áno' : 'nie'
}

function Facts({ person }) {
  const rows = [
    ['Vek', person.birth_date ? `${formatAge(person.age)}${person.birth_date_approx ? ' (približne)' : ''}` : '—'],
    ['Dátum narodenia', person.birth_date ? `${formatDate(person.birth_date)}${person.birth_date_approx ? ' (približný)' : ''}` : '—'],
    ['Pohlavie', person.gender || '—'],
    ['Mesto', person.city || '—'],
    ['Región', person.region || '—'],
    ['Výška', person.height_cm ? `${person.height_cm} cm` : '—'],
    ['Konfekcia', person.clothing_size || '—'],
    ['Topánky', person.shoe_size != null ? String(Number(person.shoe_size)) : '—'],
    ['Vlasy', person.hair_color || '—'],
    ['Oči', person.eye_color || '—'],
    ['Tetovania', person.has_tattoos ? `áno${person.tattoo_note ? ` — ${person.tattoo_note}` : ''}` : 'nie'],
    ['Jazyky', person.languages?.length ? person.languages.join(', ') : '—'],
    ['Vodičský preukaz', yesNo(person.driving_licence)],
    ['Zručnosti', person.skills?.length ? person.skills.join(', ') : '—'],
    ['Súhlas so spracovaním', person.consent_at ? formatDate(person.consent_at) : '—'],
    ['Naposledy kontaktovaný', person.last_contacted_at ? formatDate(person.last_contacted_at) : '—'],
  ]
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-stone-900">Údaje</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-stone-500">{label}</dt>
            <dd className="text-stone-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function olderThanDays(ms, days) {
  return Date.now() - ms > days * 24 * 3600 * 1000
}

function Gallery({ photos, person }) {
  const [index, setIndex] = useState(0)
  const count = photos.length
  const current = photos[Math.min(index, count - 1)]

  useEffect(() => {
    if (count < 2) return undefined
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % count)
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + count) % count)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [count])

  if (count === 0) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-stone-100 text-sm text-stone-400">
        Profil zatiaľ nemá fotografie
      </div>
    )
  }

  const isChild = person.age != null && person.age < CHILD_AGE
  const takenMs = current.taken_on ? new Date(current.taken_on).getTime() : null
  const staleForChild = isChild && (takenMs == null || olderThanDays(takenMs, STALE_CHILD_PHOTO_DAYS))

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-stone-100">
        <PersonPhoto key={current.id} path={current.storage_path} alt={fullName(person)} className="h-full w-full object-contain!" />
        {count > 1 && (
          <>
            <GalleryArrow side="left" onClick={() => setIndex((i) => (i - 1 + count) % count)} />
            <GalleryArrow side="right" onClick={() => setIndex((i) => (i + 1) % count)} />
            <span className="absolute bottom-2 right-2 rounded bg-stone-900/70 px-2 py-0.5 text-xs text-white">
              {Math.min(index, count - 1) + 1} / {count}
            </span>
          </>
        )}
      </div>
      <p className="text-sm text-stone-600">
        {current.taken_on ? `Nafotené ${formatDate(current.taken_on)} · ` : ''}
        {photoAgeLabel(current.taken_on)}
      </p>
      {staleForChild && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">
          Pozor: ide o dieťa a fotka je {takenMs == null ? 'bez dátumu nafotenia' : 'staršia ako rok'} — vzhľad sa mohol výrazne zmeniť.
        </p>
      )}
      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Fotka ${i + 1}`}
              aria-current={i === index}
              className={cx('h-20 w-16 shrink-0 overflow-hidden rounded-lg border-2', i === index ? 'border-stone-900' : 'border-transparent')}
            >
              <PersonPhoto path={p.thumb_path || p.storage_path} className="h-full w-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GalleryArrow({ side, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Predchádzajúca fotka' : 'Ďalšia fotka'}
      className={cx(
        'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl shadow hover:bg-white',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  )
}
