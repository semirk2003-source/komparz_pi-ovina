import { PeopleBrowser } from './PeopleBrowser.jsx'
import { Spinner } from '../../components/ui.jsx'
import { useFavorites } from './hooks.js'

// Osobné označenie — kolegovia vaších obľúbených nevidia.
export function FavoritesPage() {
  const { ids, isLoading } = useFavorites()
  if (isLoading) return <Spinner label="Načítavam obľúbených…" />
  return (
    <PeopleBrowser
      title="Obľúbení"
      subtitle="Vaše osobné označenie profilov. Kolegovia ho nevidia."
      restrictIds={ids}
      emptyTitle="Zatiaľ nemáte žiadnych obľúbených."
      emptyText="Srdiečkom na dlaždici alebo v detaile profilu si človeka označíte."
    />
  )
}
