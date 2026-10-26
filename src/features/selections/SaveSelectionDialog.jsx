import { useState } from 'react'
import { Button, Field, Input, Modal } from '../../components/ui.jsx'

// mode: 'new' | 'update' | 'edit'
export function SaveSelectionDialog({ open, onClose, onSubmit, initial, mode = 'new', busy }) {
  return (
    <Modal open={open} onClose={onClose} title={mode === 'new' ? 'Uložiť ako nový výber' : 'Upraviť údaje výberu'} size="sm">
      {open && <SaveForm key={mode + (initial?.name || '')} initial={initial} mode={mode} busy={busy} onSubmit={onSubmit} onClose={onClose} />}
    </Modal>
  )
}

function SaveForm({ initial, mode, busy, onSubmit, onClose }) {
  const [name, setName] = useState(initial?.name || '')
  const [projectName, setProjectName] = useState(initial?.project_name || '')
  const [subtitle, setSubtitle] = useState(initial?.subtitle || '')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Zadajte názov výberu.')
      return
    }
    try {
      await onSubmit({ name: name.trim(), project_name: projectName.trim(), subtitle: subtitle.trim() })
      onClose()
    } catch {
      // chybu už zobrazil toast
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Názov výberu" error={error} hint="Napríklad: Rýchly prachy – klub 19. 8.">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Rýchly prachy – klub 19. 8." />
      </Field>
      <Field label="Názov projektu" hint="Použije sa v exportoch (PDF, PPTX).">
        <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </Field>
      <Field label="Podnadpis">
        <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={onClose}>Zrušiť</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Ukladám…' : mode === 'new' ? 'Uložiť' : 'Uložiť zmeny'}
        </Button>
      </div>
    </form>
  )
}
