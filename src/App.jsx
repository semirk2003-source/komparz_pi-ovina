import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.js'
import { LoginPage } from './auth/LoginPage.jsx'
import { SetPasswordPage } from './auth/SetPasswordPage.jsx'
import { IS_MISCONFIGURED } from './api/backend.js'
import { SET_PASSWORD_PATH } from './api/auth.js'
import { Layout } from './components/Layout.jsx'
import { Spinner, Button } from './components/ui.jsx'
import { PeoplePage } from './features/people/PeoplePage.jsx'
import { FavoritesPage } from './features/people/FavoritesPage.jsx'
import { SavedSelectionsPage } from './features/selections/SavedSelectionsPage.jsx'
import { SelectionDetailPage } from './features/selections/SelectionDetailPage.jsx'
import { ArchivePage } from './features/archive/ArchivePage.jsx'
import { LeaderboardPage } from './features/archive/LeaderboardPage.jsx'
import { AliasesPage } from './features/archive/AliasesPage.jsx'
import { ImportPage } from './features/admin/ImportPage.jsx'
import { SettingsPage } from './features/admin/SettingsPage.jsx'

export default function App() {
  const { status, user, permissions, signOut } = useAuth()
  const location = useLocation()

  if (IS_MISCONFIGURED) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">Aplikácia nie je nastavená</h1>
        <p className="max-w-md text-sm text-stone-600">
          Chýbajú prístupové údaje k databáze (VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY). Doplňte ich v nastaveniach
          hostingu a aplikáciu nasaďte znova.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  // Neprihlásený človek sa nedostane nikam inam než na prihlásenie.
  if (status === 'signedOut') return <LoginPage />

  // Odkaz z e-mailu (obnova hesla, pozvánka) prihlási používateľa a privedie ho sem.
  if (location.pathname === SET_PASSWORD_PATH) return <SetPasswordPage />

  if (status === 'inactive') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">Účet zatiaľ nie je aktívny</h1>
        <p className="max-w-md text-sm text-stone-600">
          Ste prihlásený ako {user?.email}, ale správca vám ešte nepridelil prístup. Ozvite sa mu, prosím.
        </p>
        <Button onClick={signOut}>Odhlásiť</Button>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PeoplePage />} />
        <Route path="oblubeni" element={<FavoritesPage />} />
        <Route path="vybery" element={<SavedSelectionsPage />} />
        <Route path="vybery/:selectionId" element={<SelectionDetailPage />} />
        <Route path="archiv" element={<ArchivePage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="nazvy" element={permissions.canEdit ? <AliasesPage /> : <Navigate to="/" replace />} />
        <Route path="import" element={permissions.isAdmin ? <ImportPage /> : <Navigate to="/" replace />} />
        <Route path="nastavenia" element={permissions.isAdmin ? <SettingsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
