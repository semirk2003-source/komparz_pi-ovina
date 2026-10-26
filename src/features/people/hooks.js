import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listFavoriteIds, setFavorite } from '../../api/favorites.js'
import { getPersonDetail, getPersonHistory, listRegistrations } from '../../api/people.js'
import { PEOPLE_LIST_KEY } from '../../hooks/usePeopleList.js'
import { useToast } from '../../components/toast/ToastContext.js'
import { parseFilters, writeFilters } from './peopleFilters.js'

export const FAVORITES_KEY = ['favorites']
export const REGISTRATIONS_KEY = ['registrations']
export const personKey = (id) => ['person', Number(id)]
export const personHistoryKey = (id) => ['person-history', Number(id)]

// Filtre v URL. `lastKey` si pamätá naposledy zmenený filter (na „uvoľniť posledný filter").
export function useFilters() {
  const [params, setParams] = useSearchParams()
  const [lastKey, setLastKey] = useState(null)
  const paramsKey = params.toString()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => parseFilters(params), [paramsKey])

  const setFilters = useCallback(
    (updater, changedKey) => {
      if (changedKey) setLastKey(changedKey)
      setParams(
        (prev) => {
          const current = parseFilters(prev)
          const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
          return writeFilters(prev, next)
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return { filters, setFilters, lastKey }
}

export function useFavorites() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const query = useQuery({ queryKey: FAVORITES_KEY, queryFn: listFavoriteIds, staleTime: 5 * 60 * 1000 })
  const ids = useMemo(() => new Set(query.data || []), [query.data])

  const mutation = useMutation({
    mutationFn: ({ personId, favorite }) => setFavorite(personId, favorite),
    onMutate: async ({ personId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: FAVORITES_KEY })
      const prev = queryClient.getQueryData(FAVORITES_KEY)
      queryClient.setQueryData(FAVORITES_KEY, (old = []) =>
        favorite ? [...new Set([...old, personId])] : old.filter((id) => id !== personId),
      )
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      queryClient.setQueryData(FAVORITES_KEY, ctx?.prev)
      toast.error(err)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }),
  })

  const { mutate } = mutation
  const toggle = useCallback(
    (personId) => mutate({ personId, favorite: !ids.has(personId) }),
    [mutate, ids],
  )

  return { ids, toggle, isLoading: query.isLoading }
}

export function useRegistrations() {
  const query = useQuery({ queryKey: REGISTRATIONS_KEY, queryFn: listRegistrations, staleTime: 10 * 60 * 1000 })
  return query.data || []
}

export function usePersonDetail(personId) {
  return useQuery({
    queryKey: personKey(personId),
    queryFn: () => getPersonDetail(personId),
    enabled: personId != null,
  })
}

export function usePersonHistory(personId, enabled) {
  return useQuery({
    queryKey: personHistoryKey(personId),
    queryFn: () => getPersonHistory(personId),
    enabled: enabled && personId != null,
  })
}

// Po zmene profilu obnoví detail, históriu aj odľahčený zoznam.
export function useInvalidatePerson() {
  const queryClient = useQueryClient()
  return useCallback(
    (personId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: personKey(personId) }),
        queryClient.invalidateQueries({ queryKey: personHistoryKey(personId) }),
        queryClient.invalidateQueries({ queryKey: PEOPLE_LIST_KEY }),
      ]),
    [queryClient],
  )
}
