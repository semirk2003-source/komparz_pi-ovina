import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.js'
import { ROLE_LABELS } from '../constants/polia.js'
import { IS_DEMO } from '../api/backend.js'
import { resetDemoDb } from '../api/local/db.js'
import { SelectionBar } from '../features/selections/SelectionBar.jsx'
import { ProfileDetail } from '../features/people/ProfileDetail.jsx'
import { useOpenProfileId } from '../hooks/useOpenProfile.js'
import { Button } from './ui.jsx'
import { cx } from '../lib/cx.js'

const NAV_ITEMS = [
  { to: '/', label: 'Ľudia', end: true },
  { to: '/oblubeni', label: 'Obľúbení' },
  { to: '/vybery', label: 'Výbery' },
  { to: '/archiv', label: 'Archív' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/nazvy', label: 'Správa názvov', staffOnly: true },
  { to: '/import', label: 'Import', adminOnly: true },
  { to: '/nastavenia', label: 'Nastavenia', adminOnly: true },
]

export function Layout() {
  const { user, permissions, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const profileId = useOpenProfileId()

  const items = NAV_ITEMS.filter(
    (i) => (!i.adminOnly || permissions.isAdmin) && (!i.staffOnly || permissions.canEdit),
  )

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900">
      {IS_DEMO && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">
          <span>
            <strong>Demo režim</strong> — dáta sú vygenerované a uložené len v tomto prehliadači. Supabase sa zapne po doplnení <code>.env.local</code>.
          </span>
          <button type="button" className="underline" onClick={() => window.confirm('Obnoviť demo dáta do pôvodného stavu? Vaše zmeny v demo režime sa stratia.') && resetDemoDb()}>
            Obnoviť demo dáta
          </button>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2.5">
          <NavLink to="/" className="shrink-0 text-sm font-semibold uppercase tracking-[0.2em] text-stone-900">
            Komparz Stupák
          </NavLink>
          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Hlavná navigácia">
            {items.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <div className="text-right text-xs leading-tight">
              <div className="font-medium text-stone-900">{user.full_name || user.email}</div>
              <div className="text-stone-500">{ROLE_LABELS[user.role]}</div>
            </div>
            <Button size="sm" onClick={signOut}>
              Odhlásiť
            </Button>
          </div>
          <button type="button" className="ml-auto rounded-lg border border-stone-300 px-3 py-1.5 text-sm lg:hidden" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            Menu
          </button>
        </div>
        {menuOpen && (
          <nav className="flex flex-col gap-1 border-t border-stone-200 px-4 py-3 lg:hidden" aria-label="Hlavná navigácia">
            {items.map((item) => (
              <NavItem key={item.to} item={item} onClick={() => setMenuOpen(false)} />
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-3 text-sm">
              <span>
                {user.full_name || user.email} · <span className="text-stone-500">{ROLE_LABELS[user.role]}</span>
              </span>
              <Button size="sm" onClick={signOut}>
                Odhlásiť
              </Button>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-32 pt-5">
        <Outlet />
      </main>

      <SelectionBar />
      {profileId != null && <ProfileDetail personId={profileId} />}
    </div>
  )
}

function NavItem({ item, onClick }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900')
      }
    >
      {item.label}
    </NavLink>
  )
}
