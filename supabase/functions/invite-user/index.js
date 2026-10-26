// Supabase Edge Function: pozvanie nového používateľa e-mailom (UC-13).
// Beží na serveri Supabase (Deno). Potrebuje service_role kľúč, ktorý
// Supabase do funkcie vkladá sám (premenná SUPABASE_SERVICE_ROLE_KEY) —
// nikdy ho nedávajte do aplikácie v prehliadači.
//
// Nasadenie:  supabase functions deploy invite-user
//             supabase secrets set ALLOWED_ORIGINS=https://vasa-adresa.vercel.app,http://localhost:5173
// Volanie z aplikácie: src/api/admin.js → inviteUser()

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ROLES = ['admin', 'caster', 'viewer']
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Nepodporovaná metóda.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Nie ste prihlásený.' }, 401)

  // 1. Kto volá? Overenie JWT volajúceho.
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Nie ste prihlásený.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 2. Je to aktívny správca?
  const { data: caller, error: callerError } = await admin
    .from('app_users')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerError) return json({ error: 'Nepodarilo sa overiť oprávnenie.' }, 500)
  if (!caller || !caller.is_active || caller.role !== 'admin') {
    return json({ error: 'Pozývať používateľov môže len správca.' }, 403)
  }

  // 3. Vstup
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Neplatná požiadavka.' }, 400)
  }
  const email = String(body?.email || '').trim().toLowerCase()
  const fullName = String(body?.full_name || '').trim() || email.split('@')[0]
  const role = body?.role
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'Zadajte platný e-mail.' }, 400)
  if (!ROLES.includes(role)) return json({ error: 'Neplatná rola.' }, 400)

  const { data: existing } = await admin.from('app_users').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return json({ error: 'Používateľ s týmto e-mailom už existuje. Upravte mu rolu alebo obnovte prístup v zozname.' }, 409)
  }

  // 4. Pozvánka. Trigger on_auth_user_created založí riadok v app_users (neaktívny).
  // Odkaz z pozvánky smie viesť len na adresy aplikácie (premenná ALLOWED_ORIGINS,
  // napr. „https://komparz.vercel.app,http://localhost:5173"). Inak sa použije Site URL.
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean)
  let redirectTo
  // Bez nastavených ALLOWED_ORIGINS sa adresa od klienta ignoruje a platí Site URL.
  if (allowed.length > 0 && typeof body?.redirect_to === 'string') {
    try {
      const target = new URL(body.redirect_to)
      if (!allowed.includes(target.origin)) {
        return json({ error: 'Adresa pre pozvánku nie je povolená (ALLOWED_ORIGINS).' }, 400)
      }
      redirectTo = target.toString()
    } catch {
      return json({ error: 'Neplatná adresa pre pozvánku.' }, 400)
    }
  }
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo,
  })
  if (inviteError || !invited?.user) {
    return json({ error: `Pozvánku sa nepodarilo odoslať: ${inviteError?.message || 'neznáma chyba'}` }, 400)
  }

  // 5. Rola a aktivácia — robí to server, nie metadáta od klienta.
  const { data: appUser, error: updateError } = await admin
    .from('app_users')
    .upsert(
      { id: invited.user.id, email, full_name: fullName, role, is_active: true },
      { onConflict: 'id' },
    )
    .select('id, email, full_name, role, is_active, created_at')
    .single()
  if (updateError) {
    return json({ error: `Pozvánka odišla, ale rolu sa nepodarilo nastaviť: ${updateError.message}` }, 500)
  }

  return json({ user: appUser })
})
