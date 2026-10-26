import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IS_DEMO } from '../../api/backend.js'
import { subscribe } from '../../api/local/db.js'
import { TABLES } from '../../constants/polia.js'
import {
  getArchiveFacets, getFilmography, getLeaderboard, listAppearances, listNameValues,
} from '../../api/archive.js'
import { useToast } from '../../components/toast/ToastContext.js'

export const ARCHIVE_KEY = ['archive']

export const archiveKeys = {
  appearances: () => [...ARCHIVE_KEY, 'appearances'],
  filmography: (personId) => [...ARCHIVE_KEY, 'filmography', personId],
  leaderboard: (production, series) => [...ARCHIVE_KEY, 'leaderboard', production || '', series || ''],
  facets: () => [...ARCHIVE_KEY, 'facets'],
  names: (kind) => [...ARCHIVE_KEY, 'names', kind],
}

// V demo režime sa zmeny z iných kariet premietnu bez obnovenia stránky.
export function useArchiveSync() {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!IS_DEMO) return undefined
    return subscribe((tables) => {
      if (tables.includes('*') || tables.includes(TABLES.APPEARANCES) || tables.includes(TABLES.ROLE_ALIASES)) {
        queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY })
      }
    })
  }, [queryClient])
}

export function useAppearances() {
  useArchiveSync()
  return useQuery({ queryKey: archiveKeys.appearances(), queryFn: listAppearances, staleTime: 60 * 1000 })
}

export function useFilmography(personId) {
  useArchiveSync()
  return useQuery({
    queryKey: archiveKeys.filmography(personId),
    queryFn: () => getFilmography(personId),
    enabled: personId != null,
  })
}

export function useLeaderboard(production, series) {
  useArchiveSync()
  return useQuery({
    queryKey: archiveKeys.leaderboard(production, series),
    queryFn: () => getLeaderboard({ production: production || null, series: series || null }),
    staleTime: 60 * 1000,
  })
}

export function useArchiveFacets() {
  return useQuery({ queryKey: archiveKeys.facets(), queryFn: getArchiveFacets, staleTime: 5 * 60 * 1000 })
}

export function useNameValues(kind) {
  useArchiveSync()
  return useQuery({ queryKey: archiveKeys.names(kind), queryFn: () => listNameValues(kind) })
}

// Mutácia, ktorá po úspechu obnoví všetky dáta archívu a pri chybe ukáže hlášku.
export function useArchiveMutation(fn, { successMessage } = {}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY })
      if (successMessage) toast.show({ message: successMessage, tone: 'success' })
    },
    onError: (err) => toast.error(err),
  })
}
