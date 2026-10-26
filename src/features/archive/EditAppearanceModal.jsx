import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal, Button, Field, Input, Spinner, ErrorMessage } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { getAppearance, revertAppearance, updateAppearance } from '../../api/archive.js'
import { ARCHIVE_KEY, useArchiveMutation } from './archiveQueries.js'

const FIELDS = [
  { key: 'role_name', original: 'original_role_name', label: 'Postava' },
  { key: 'production_name', original: 'original_production_name', label: 'Projekt' },
  { key: 'series_name', original: 'original_series_name', label: 'Séria' },
]

// Ručná oprava záznamu s možnosťou vrátiť pôvodné hodnoty zo súpisky.
// Zoznam archívu pôvodné hodnoty (original_*) neobsahuje — doťahujú sa tu.
export function EditAppearanceModal({ appearanceId, suggestions, onClose }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...ARCHIVE_KEY, 'appearance', appearanceId],
    queryFn: () => getAppearance(appearanceId),
    staleTime: 0,
  })
  if (isLoading || error) {
    return (
      <Modal open onClose={onClose} title="Oprava archívneho záznamu" footer={<Button onClick={onClose}>Zavrieť</Button>}>
        {isLoading ? <Spinner /> : <ErrorMessage error={error} onRetry={refetch} />}
      </Modal>
    )
  }
  return <EditForm appearance={data} suggestions={suggestions} onClose={onClose} />
}

function EditForm({ appearance, suggestions, onClose }) {
  const [form, setForm] = useState({
    name_override: appearance.name_override || '',
    shoot_date: appearance.shoot_date || '',
    role_name: appearance.role_name || '',
    production_name: appearance.production_name || '',
    series_name: appearance.series_name || '',
  })

  const save = useArchiveMutation((patch) => updateAppearance(appearance.id, patch), {
    successMessage: 'Záznam je uložený.',
  })
  const revert = useArchiveMutation(() => revertAppearance(appearance.id), {
    successMessage: 'Záznam je vrátený na pôvodné hodnoty.',
  })

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const changedFromOriginal =
    !!appearance.name_override ||
    appearance.shoot_date !== appearance.original_shoot_date ||
    FIELDS.some((f) => (appearance[f.key] || '') !== (appearance[f.original] || ''))

  function submit(e) {
    e.preventDefault()
    save.mutate(form, { onSuccess: onClose })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Oprava archívneho záznamu"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            disabled={!changedFromOriginal || revert.isPending}
            onClick={() => revert.mutate(undefined, { onSuccess: onClose })}
          >
            Vrátiť pôvodné hodnoty
          </Button>
          <Button onClick={onClose}>Zrušiť</Button>
          <Button variant="primary" type="submit" form="edit-appearance" disabled={save.isPending}>
            Uložiť
          </Button>
        </>
      }
    >
      <form id="edit-appearance" onSubmit={submit} className="flex flex-col gap-4">
        <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
          <span className="text-stone-500">Pôvodné meno zo súpisky (nemení sa): </span>
          <strong>{appearance.raw_name}</strong>
        </div>
        <Field label="Opravené meno" hint="Vyplňte len vtedy, keď je meno zo súpisky chybné.">
          <Input value={form.name_override} onChange={set('name_override')} placeholder={appearance.raw_name} />
        </Field>
        <Field label="Dátum nakrúcania" hint={`Pôvodne: ${formatDate(appearance.original_shoot_date) || '—'}`}>
          <Input type="date" required value={form.shoot_date} onChange={set('shoot_date')} />
        </Field>
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={`Pôvodne: ${appearance[f.original] || '—'}`}>
            <Input value={form[f.key]} onChange={set(f.key)} list={`edit-${f.key}-list`} />
            <datalist id={`edit-${f.key}-list`}>
              {(suggestions?.[f.key] || []).map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
        ))}
      </form>
    </Modal>
  )
}
