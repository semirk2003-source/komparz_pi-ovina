import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePeopleList } from '../../hooks/usePeopleList.js'
import { usePermissions } from '../../auth/AuthContext.js'
import { getPeopleContacts } from '../../api/people.js'
import { getAppearanceStats } from '../../api/archive.js'
import { fullName } from '../../lib/format.js'

const CONTACT_STALE_MS = 60 * 1000

function idsKey(ids) {
  return [...ids].sort((a, b) => a - b).join(',')
}

// Kontakty sa pamätajú po jednotlivých osobách, takže pridanie jednej osoby
// do výberu stiahne len jej kontakt, nie celý výber znova.
const contactKey = (personId) => ['people-contacts', 'person', personId]

function freshContact(queryClient, personId) {
  const state = queryClient.getQueryState(contactKey(personId))
  if (!state || state.data === undefined || state.isInvalidated) return undefined
  if (Date.now() - state.dataUpdatedAt > CONTACT_STALE_MS) return undefined
  return state.data
}

/**
 * Kontakty (telefón, e-mail, adresa, dátum narodenia) — len pre casting a správcu.
 * Vracia { data: Map<personId, contact>, isLoading, error }.
 */
export function usePeopleContacts(personIds, enabled = true) {
  const { canSeeContacts } = usePermissions()
  const queryClient = useQueryClient()
  const active = enabled && canSeeContacts && personIds.length > 0
  const missing = active ? personIds.filter((id) => freshContact(queryClient, id) === undefined) : []
  const missingKey = idsKey(missing)

  const batch = useQuery({
    queryKey: ['people-contacts', 'batch', missingKey],
    queryFn: async () => {
      const ids = missingKey.split(',').map(Number)
      const map = await getPeopleContacts(ids)
      for (const id of ids) queryClient.setQueryData(contactKey(id), map.get(id) ?? null)
      return map
    },
    enabled: missing.length > 0,
    staleTime: CONTACT_STALE_MS,
  })

  if (!active) return { data: undefined, isLoading: false, error: null }
  const data = new Map()
  for (const id of personIds) {
    const c = freshContact(queryClient, id) ?? batch.data?.get?.(id)
    if (c) data.set(id, c)
  }
  return {
    data,
    isLoading: missing.length > 0 && batch.fetchStatus !== 'idle' && !batch.data,
    error: batch.error,
  }
}

export function useAppearanceStats(personIds, enabled = true) {
  const key = idsKey(personIds)
  return useQuery({
    queryKey: ['appearance-stats', key],
    queryFn: () => getAppearanceStats(personIds),
    enabled: enabled && personIds.length > 0,
    staleTime: 60 * 1000,
  })
}

/**
 * Spojí položky výberu s odľahčeným zoznamom profilov, kontaktmi a štatistikou
 * účinkovania. items: [{ personId, note }]
 * Vracia { rows, isLoading, contactsLoading, contactsError, statsLoading, statsError, missingPeople }
 * rows = [{ id, person, note, name, phone, email, address, birth_date, stats }]
 */
export function useSelectionRows(items, { withContacts = true, withStats = true } = {}) {
  const { byId, isLoading: peopleLoading } = usePeopleList()
  const personIds = useMemo(() => items.map((i) => i.personId), [items])
  const contactsQ = usePeopleContacts(personIds, withContacts)
  const statsQ = useAppearanceStats(personIds, withStats)

  const contacts = contactsQ.data
  const stats = statsQ.data
  const rows = items
    .map((it, index) => {
      const person = byId.get(it.personId)
      if (!person) return null
      const c = contacts?.get(it.personId) || null
      return {
        id: it.personId,
        index,
        person,
        note: it.note || '',
        name: fullName(person),
        phone: c?.phone ?? null,
        email: c?.email ?? null,
        address: c?.address ?? null,
        birth_date: c?.birth_date ?? person.birth_date ?? null,
        stats: stats?.get?.(it.personId) || null,
      }
    })
    .filter(Boolean)

  return {
    rows,
    isLoading: peopleLoading,
    contactsLoading: contactsQ.isLoading,
    contactsError: contactsQ.error,
    statsLoading: withStats && personIds.length > 0 && statsQ.isLoading && statsQ.fetchStatus !== 'idle',
    statsError: statsQ.error,
    missingPeople: peopleLoading ? 0 : items.length - rows.length,
  }
}
