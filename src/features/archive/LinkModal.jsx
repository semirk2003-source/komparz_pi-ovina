import { Modal, Button } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { linkAppearance } from '../../api/archive.js'
import { PersonPicker } from './PersonPicker.jsx'
import { useArchiveMutation } from './archiveQueries.js'

// UC-08: priradenie archívneho záznamu k profilu. Výber človekom = potvrdené.
export function LinkModal({ appearance, people, onClose }) {
  const link = useArchiveMutation(({ id, personId }) => linkAppearance(id, personId), {
    successMessage: 'Záznam je prepojený s profilom.',
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Priradiť záznam k profilu"
      footer={<Button onClick={onClose}>Zrušiť</Button>}
    >
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Meno zo súpisky</dt>
        <dd className="font-medium">{appearance.raw_name}</dd>
        {appearance.name_override && (
          <>
            <dt className="text-stone-500">Opravené meno</dt>
            <dd>{appearance.name_override}</dd>
          </>
        )}
        <dt className="text-stone-500">Nakrúcanie</dt>
        <dd>
          {formatDate(appearance.shoot_date)} · {appearance.production_effective || '—'}
          {appearance.series_effective ? ` · ${appearance.series_effective}` : ''} · {appearance.role_effective || '—'}
        </dd>
      </dl>
      <PersonPicker
        rawName={appearance.display_name}
        people={people}
        selectedId={appearance.person_id}
        onPick={(person) => link.mutate({ id: appearance.id, personId: person.id }, { onSuccess: onClose })}
      />
      <p className="mt-3 text-xs text-stone-500">
        Ak človek v databáze nie je, nechajte záznam nepriradený — zostane v archíve a započíta sa do celkových počtov.
        Pôvodné meno zo súpisky sa nikdy neprepisuje.
      </p>
    </Modal>
  )
}
