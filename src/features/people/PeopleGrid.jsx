import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { PersonPhoto } from '../../components/PersonPhoto.jsx'
import { AddToSelectionButton } from '../selections/AddToSelectionButton.jsx'
import { usePermissions } from '../../auth/AuthContext.js'
import { useOpenProfile } from '../../hooks/useOpenProfile.js'
import { formatAge, fullName } from '../../lib/format.js'
import { cx } from '../../lib/cx.js'
import { useFavorites } from './hooks.js'

const MIN_TILE = 168
const GAP = 12
const TEXT_HEIGHT = 84

/**
 * Virtualizovaná mriežka dlaždíc profilov. Vykresľuje len riadky viditeľné
 * v okne, takže zvládne tisíce profilov bez sekania.
 * people: pole z people_list (usePeopleList / filtre).
 */
export function PeopleGrid({ people }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [offset, setOffset] = useState(0)
  const { canEdit } = usePermissions()
  const openProfile = useOpenProfile()
  const { ids: favoriteIds, toggle: toggleFavorite } = useFavorites()

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const measure = () => {
      setWidth(el.clientWidth)
      setOffset(el.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    // Telo stránky sledujeme kvôli zmene výšky obsahu nad mriežkou (rozbalené filtre).
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [])

  const columns = Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const tileWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_TILE
  const rowHeight = Math.round(tileWidth * (4 / 3) + TEXT_HEIGHT + GAP)
  const rowCount = Math.ceil(people.length / columns)

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin: offset,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, columns, virtualizer])

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const start = row.index * columns
        const items = people.slice(start, start + columns)
        return (
          <div
            key={row.key}
            className="absolute left-0 top-0 grid w-full"
            style={{
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: GAP,
              height: rowHeight - GAP,
            }}
          >
            {items.map((p) => (
              <PersonTile
                key={p.id}
                person={p}
                canEdit={canEdit}
                favorite={favoriteIds.has(p.id)}
                onToggleFavorite={toggleFavorite}
                onOpen={openProfile}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

const PersonTile = memo(function PersonTile({ person, canEdit, favorite, onToggleFavorite, onOpen }) {
  const name = fullName(person)
  const sizes = [person.clothing_size, person.shoe_size != null ? `top. ${Number(person.shoe_size)}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md',
        person.is_active === false ? 'border-dashed border-stone-300 opacity-70' : 'border-stone-200',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(person.id)}
        className="flex flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-stone-900"
        aria-label={`Otvoriť profil ${name}`}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-stone-100">
          <PersonPhoto path={person.thumb_path} alt={name} className="h-full w-full" />
          {person.is_active === false && (
            <span className="absolute bottom-2 left-2 rounded bg-stone-900/80 px-1.5 py-0.5 text-[11px] text-white">neaktívny</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2 text-sm">
          <span className="truncate font-medium text-stone-900">{name || 'Bez mena'}</span>
          <span className="truncate text-xs text-stone-600">
            {formatAge(person.age)}
            {person.city ? ` · ${person.city}` : ''}
          </span>
          <span className="truncate text-xs text-stone-500">{sizes || ' '}</span>
        </div>
      </button>
      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        {canEdit && <AddToSelectionButton personId={person.id} size="sm" />}
        <button
          type="button"
          onClick={() => onToggleFavorite(person.id)}
          aria-pressed={favorite}
          aria-label={favorite ? 'Odobrať z obľúbených' : 'Pridať do obľúbených'}
          title={favorite ? 'Odobrať z obľúbených' : 'Pridať do obľúbených'}
          className={cx(
            'flex h-8 w-8 items-center justify-center rounded-full text-base shadow-sm transition-colors',
            favorite ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-white/95 text-stone-500 hover:text-rose-600',
          )}
        >
          {favorite ? '♥' : '♡'}
        </button>
      </div>
    </article>
  )
})
