import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PHOTO_LIMITS } from '../../constants/polia.js'
import { deletePersonPhoto, setPrimaryPhoto, updatePhoto, uploadPersonPhoto } from '../../api/people.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { Badge, Button, ErrorMessage, Field, Input, Modal } from '../../components/ui.jsx'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { photoAgeLabel } from '../../lib/format.js'
import { useInvalidatePerson } from './hooks.js'
import { useStorageCleanup } from './useStorageCleanup.js'
import { readExifDate } from './exifDate.js'

// UC-11: správa fotografií profilu (len casting a správca).
export function PhotoManager({ person, photos: rawPhotos, onClose }) {
  const photos = rawPhotos.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const invalidate = useInvalidatePerson()
  const toast = useToast()
  const reportCleanup = useStorageCleanup()
  const fileRef = useRef(null)
  const [takenOn, setTakenOn] = useState('')
  const [progress, setProgress] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const remaining = PHOTO_LIMITS.MAX_PER_PERSON - photos.length
  const today = new Date().toISOString().slice(0, 10)

  const refresh = () => invalidate(person.id)

  const action = useMutation({
    mutationFn: ({ kind, photo, value }) => {
      if (kind === 'delete') return deletePersonPhoto(photo.id)
      if (kind === 'primary') return setPrimaryPhoto(photo.id)
      if (kind === 'takenOn') return updatePhoto(photo.id, { taken_on: value })
      if (kind === 'order') return updatePhoto(photo.id, { sort_order: value })
      return null
    },
    onSuccess: (result) => {
      refresh()
      reportCleanup(result?.failedFiles)
    },
    onError: toast.error,
  })

  async function upload(e) {
    const files = [...(e.target.files || [])].slice(0, Math.max(0, remaining))
    e.target.value = ''
    if (files.length === 0) return
    // Dátum nafotenia z EXIF musíme prečítať pred zmenšením — canvas metadáta odstráni.
    // Ručne zadaný dátum má prednosť pred EXIF.
    const exifDates = await Promise.all(files.map(readExifDate))
    const dates = exifDates.map((d) => takenOn || d || null)
    const withoutDate = dates.filter((d) => !d).length
    if (withoutDate > 0 && !window.confirm(`${withoutDate === files.length ? 'Fotky nemajú' : `${withoutDate} z ${files.length} fotiek nemá`} dátum nafotenia (ani v EXIF). Pri deťoch je dôležitý. Pokračovať bez neho?`)) return
    setUploadError(null)
    let done = 0
    let fromExif = 0
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Spracúvam a nahrávam ${done + 1} / ${files.length}…`)
        await uploadPersonPhoto(person.id, file, { takenOn: dates[i] })
        if (!takenOn && exifDates[i]) fromExif++
        done++
      }
      toast.show({
        message: `Nahraté fotografie: ${done}.${fromExif ? ` Dátum nafotenia z EXIF: ${fromExif}.` : ''}`,
        tone: 'success',
      })
    } catch (err) {
      setUploadError(err)
    } finally {
      setProgress(null)
      refresh()
    }
  }

  function move(index, dir) {
    const ordered = photos.slice()
    const target = index + dir
    if (target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    Promise.all(ordered.map((p, i) => (p.sort_order !== i ? updatePhoto(p.id, { sort_order: i }) : null)))
      .then(refresh)
      .catch(toast.error)
  }

  return (
    <Modal open onClose={onClose} title="Fotografie profilu" size="lg" footer={<Button onClick={onClose}>Hotovo</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <Field label="Dátum nafotenia" hint="Kedy bola fotka nafotená, nie nahratá. Ak ho nevyplníte, použije sa dátum z fotky (EXIF).">
            <Input type="date" max={today} value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
          </Field>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={upload} />
          <Button variant="primary" disabled={remaining <= 0 || !!progress} onClick={() => fileRef.current?.click()}>
            {remaining <= 0 ? 'Dosiahnutý limit 5 fotiek' : 'Nahrať fotografie'}
          </Button>
          <p className="w-full text-xs text-stone-500">
            Fotka sa pred nahratím zmenší na {PHOTO_LIMITS.FULL_LONG_EDGE} px, vytvorí sa náhľad {PHOTO_LIMITS.THUMB_LONG_EDGE} px a
            odstránia sa skryté údaje (aj poloha GPS). Môžete pridať ešte {Math.max(0, remaining)}.
          </p>
          {progress && <p className="text-sm text-stone-700">{progress}</p>}
        </div>
        <ErrorMessage error={uploadError} />

        {photos.length === 0 && <p className="text-sm text-stone-500">Profil zatiaľ nemá žiadnu fotografiu.</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, i) => (
            <li key={photo.id} className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-2">
              <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-stone-100">
                <PersonPhoto path={photo.thumb_path || photo.storage_path} className="h-full w-full" />
                {photo.is_primary && <Badge tone="success" className="absolute left-2 top-2">Hlavná</Badge>}
              </div>
              <Field label="Nafotené" hint={photoAgeLabel(photo.taken_on)}>
                <Input
                  type="date"
                  max={today}
                  defaultValue={photo.taken_on || ''}
                  onBlur={(e) => {
                    if ((e.target.value || null) !== (photo.taken_on || null)) {
                      action.mutate({ kind: 'takenOn', photo, value: e.target.value || null })
                    }
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Posunúť dopredu">
                  ←
                </Button>
                <Button size="sm" disabled={i === photos.length - 1} onClick={() => move(i, 1)} aria-label="Posunúť dozadu">
                  →
                </Button>
                {!photo.is_primary && (
                  <Button size="sm" onClick={() => action.mutate({ kind: 'primary', photo })}>
                    Nastaviť ako hlavnú
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => window.confirm('Naozaj zmazať túto fotografiu? Krok sa nedá vrátiť.') && action.mutate({ kind: 'delete', photo })}
                >
                  Zmazať
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
