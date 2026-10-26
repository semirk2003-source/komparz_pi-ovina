import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listPeople } from '../api/people.js'
import { IS_DEMO } from '../api/backend.js'
import { subscribe } from '../api/local/db.js'

export const PEOPLE_LIST_KEY = ['people-list']

const PEOPLE_TABLES = new Set(['*', 'people', 'person_photos', 'person_registrations'])

// Odľahčený zoznam všetkých profilov — načíta sa raz a filtruje v prehliadači.
export function usePeopleList() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: PEOPLE_LIST_KEY,
    queryFn: listPeople,
    staleTime: 5 * 60 * 1000,
  })

  // V demo režime obnoviť zoznam po zmene v tejto aj v inej karte.
  useEffect(() => {
    if (!IS_DEMO) return undefined
    return subscribe((tables) => {
      if (tables.some((t) => PEOPLE_TABLES.has(t))) {
        queryClient.invalidateQueries({ queryKey: PEOPLE_LIST_KEY })
      }
    })
  }, [queryClient])

  const people = query.data
  const byId = useMemo(() => {
    const map = new Map()
    for (const p of people || []) map.set(p.id, p)
    return map
  }, [people])
  return { ...query, people: people || [], byId }
}
