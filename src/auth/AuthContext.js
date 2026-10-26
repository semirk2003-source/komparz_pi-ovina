import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

export function permissionsFor(role) {
  const staff = role === 'admin' || role === 'caster'
  return { canEdit: staff, canExport: staff, canSeeContacts: staff, isAdmin: role === 'admin' }
}

// { status: 'loading'|'signedOut'|'inactive'|'ready', user, permissions, signOut }
// permissions: { canEdit, canExport, canSeeContacts, isAdmin }
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth musí byť vnútri <AuthProvider>.')
  return ctx
}

export function usePermissions() {
  return useAuth().permissions
}
