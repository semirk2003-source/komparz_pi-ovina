-- =====================================================================
-- Komparz Stupák — základná schéma databázy
-- Spúšťa sa raz v Supabase SQL Editore (alebo `supabase db push`).
-- Skript je idempotentný tam, kde to ide (create ... if not exists).
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Pomocné funkcie
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Používatelia a roly
-- ---------------------------------------------------------------------

create table if not exists public.app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'viewer' check (role in ('admin','caster','viewer')),
  -- Nový účet je neaktívny, kým ho správca neaktivuje (ochrana pri zapnutej registrácii).
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and is_active
$$;

create or replace function public.is_app_user()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_app_role() is not null
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('admin','caster'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at before update on public.app_users
  for each row execute function public.set_updated_at();

-- Aplikácia nesmie zostať bez aktívneho správcu (ani omylom, ani útokom
-- na vlastný účet).
create or replace function public.app_users_keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.app_users
                     where role = 'admin' and is_active and id <> old.id) then
    raise exception 'Aplikácia musí mať aspoň jedného aktívneho správcu.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists app_users_keep_admin on public.app_users;
create trigger app_users_keep_admin before update on public.app_users
  for each row execute function public.app_users_keep_one_admin();

-- ---------------------------------------------------------------------
-- Ľudia
-- ---------------------------------------------------------------------

create table if not exists public.people (
  id                 bigint generated always as identity primary key,
  legacy_id          integer unique,
  first_name         text not null default '',
  last_name          text not null default '',
  gender             text check (gender in ('Žena','Muž','Iné')),
  birth_date         date,
  birth_date_approx  boolean not null default false,
  phone              text,
  email              text,
  address            text,
  city               text,
  region             text check (region in ('Západné Slovensko','Stredné Slovensko','Východné Slovensko','Česko','Iné / neuvedené')),
  height_cm          smallint check (height_cm between 40 and 250),
  clothing_size      text check (clothing_size in ('XS','S','M','L','XL','XXL','XXXL','Iné/detské')),
  shoe_size          numeric(3,1) check (shoe_size between 15 and 55),
  hair_color         text,
  eye_color          text,
  has_tattoos        boolean not null default false,
  tattoo_note        text,
  languages          text[] not null default '{}',
  driving_licence    boolean not null default false,
  skills             text[] not null default '{}',
  period_look        boolean not null default false,
  speaking_role      boolean not null default false,
  notes              text,
  is_active          boolean not null default true,
  anonymized_at      timestamptz,
  consent_at         date,
  last_contacted_at  date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null
);

create index if not exists people_last_name_idx on public.people (last_name, first_name);
create index if not exists people_name_trgm_idx on public.people
  using gin ((lower(first_name || ' ' || last_name)) extensions.gin_trgm_ops);

drop trigger if exists people_updated_at on public.people;
create trigger people_updated_at before update on public.people
  for each row execute function public.set_updated_at();

-- Pôvodné číslo z Excelu je kotva migrácie: raz nastavené sa už nemení.
create or replace function public.people_protect_legacy_id()
returns trigger language plpgsql as $$
begin
  if old.legacy_id is not null then
    new.legacy_id := old.legacy_id;
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;

drop trigger if exists people_protect on public.people;
create trigger people_protect before update on public.people
  for each row execute function public.people_protect_legacy_id();

-- ---------------------------------------------------------------------
-- Fotografie
-- ---------------------------------------------------------------------

create table if not exists public.person_photos (
  id            bigint generated always as identity primary key,
  person_id     bigint not null references public.people(id) on delete cascade,
  storage_path  text not null unique,       -- zmenšenina 1600 px
  thumb_path    text,                        -- náhľad 400 px
  is_primary    boolean not null default false,
  sort_order    smallint not null default 0,
  taken_on      date,                        -- kedy bola nafotená (nie nahratá)
  width         integer,
  height        integer,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null
);

create index if not exists person_photos_person_idx on public.person_photos (person_id, sort_order);
create unique index if not exists person_photos_one_primary
  on public.person_photos (person_id) where is_primary;

create or replace function public.enforce_photo_limit()
returns trigger language plpgsql as $$
begin
  -- Zámok na osobu, aby dve súbežné nahrávania neprekročili limit.
  perform pg_advisory_xact_lock(hashtext('person_photos'), new.person_id::int);
  if (select count(*) from public.person_photos where person_id = new.person_id) >= 5 then
    raise exception 'Profil môže mať najviac 5 fotografií.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists person_photos_limit on public.person_photos;
create trigger person_photos_limit before insert on public.person_photos
  for each row execute function public.enforce_photo_limit();

-- ---------------------------------------------------------------------
-- Registračné vlny
-- ---------------------------------------------------------------------

create table if not exists public.registrations (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  period_start  date,
  period_end    date,
  note          text,
  created_at    timestamptz not null default now()
);

create table if not exists public.person_registrations (
  person_id        bigint not null references public.people(id) on delete cascade,
  registration_id  bigint not null references public.registrations(id) on delete cascade,
  responded_at     date,
  extra            jsonb not null default '{}'::jsonb,  -- odpovede špecifické pre vlnu
  primary key (person_id, registration_id)
);

create index if not exists person_registrations_reg_idx on public.person_registrations (registration_id);

-- ---------------------------------------------------------------------
-- Projekty, série, archív účinkovania
-- ---------------------------------------------------------------------

create table if not exists public.productions (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  kind        text not null default 'seriál' check (kind in ('film','seriál','reklama','iné')),
  created_at  timestamptz not null default now()
);

create table if not exists public.production_series (
  id             bigint generated always as identity primary key,
  production_id  bigint not null references public.productions(id) on delete cascade,
  name           text not null,
  created_at     timestamptz not null default now(),
  unique (production_id, name)
);

create table if not exists public.appearances (
  id                        bigint generated always as identity primary key,
  -- Meno presne tak, ako prišlo zo súpisky. NIKDY sa neprepisuje.
  raw_name                  text not null,
  -- Ručne opravené meno (ak je potrebné); pôvodné zostáva v raw_name.
  name_override             text,
  shoot_date                date not null,
  role_name                 text,
  production_name           text,
  series_name               text,
  -- Pôvodné hodnoty pri vložení, aby sa dalo vrátiť k originálu.
  original_shoot_date       date,
  original_role_name        text,
  original_production_name  text,
  original_series_name      text,
  person_id                 bigint references public.people(id) on delete set null,
  match_status              text not null default 'unmatched'
                            check (match_status in ('unmatched','suggested','confirmed')),
  match_score               real,
  is_excluded               boolean not null default false,
  source                    text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by                uuid references auth.users(id) on delete set null,
  constraint appearances_confirmed_has_person
    check (match_status = 'unmatched' or person_id is not null)
);

create index if not exists appearances_person_idx on public.appearances (person_id, shoot_date desc);
create index if not exists appearances_date_idx on public.appearances (shoot_date desc);
create index if not exists appearances_status_idx on public.appearances (match_status);

-- Ochrana proti duplicite: osoba (alebo pôvodné meno) + dátum + projekt + postava.
create unique index if not exists appearances_no_duplicate on public.appearances (
  coalesce(person_id::text, 'raw:' || lower(raw_name)),
  shoot_date,
  lower(coalesce(production_name, '')),
  lower(coalesce(role_name, ''))
) where not is_excluded;

create or replace function public.appearances_protect_original()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.original_shoot_date      := coalesce(new.original_shoot_date, new.shoot_date);
    new.original_role_name       := coalesce(new.original_role_name, new.role_name);
    new.original_production_name := coalesce(new.original_production_name, new.production_name);
    new.original_series_name     := coalesce(new.original_series_name, new.series_name);
  else
    -- Jediná výnimka: anonymizácia osoby (GDPR) smie prepísať pôvodné meno.
    if coalesce(current_setting('komparz.anonymizing', true), '') <> 'on' then
      new.raw_name := old.raw_name;
    end if;
    new.original_shoot_date      := old.original_shoot_date;
    new.original_role_name       := old.original_role_name;
    new.original_production_name := old.original_production_name;
    new.original_series_name     := old.original_series_name;
    if new.match_status = 'unmatched' then
      new.person_id := null;
      new.match_score := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists appearances_protect on public.appearances;
create trigger appearances_protect before insert or update on public.appearances
  for each row execute function public.appearances_protect_original();

drop trigger if exists appearances_updated_at on public.appearances;
create trigger appearances_updated_at before update on public.appearances
  for each row execute function public.set_updated_at();

-- Pravidlá zjednocovania názvov (postavy, projekty, série).
-- Pôvodná hodnota sa nikdy neprepisuje; pravidlo sa dá kedykoľvek zmazať.
create table if not exists public.role_aliases (
  id               bigint generated always as identity primary key,
  kind             text not null default 'role' check (kind in ('role','production','series')),
  raw_value        text not null,
  canonical_value  text,
  is_excluded      boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  unique (kind, raw_value),
  constraint role_aliases_has_effect check (canonical_value is not null or is_excluded)
);

-- Archív po aplikovaní pravidiel zjednocovania. Rešpektuje RLS volajúceho.
create or replace view public.appearances_effective
with (security_invoker = true) as
select
  a.*,
  coalesce(a.name_override, a.raw_name)                as display_name,
  coalesce(ra.canonical_value, a.role_name)            as role_effective,
  coalesce(pa.canonical_value, a.production_name)      as production_effective,
  coalesce(sa.canonical_value, a.series_name)          as series_effective,
  (a.is_excluded
    or coalesce(ra.is_excluded, false)
    or coalesce(pa.is_excluded, false)
    or coalesce(sa.is_excluded, false))                as excluded_effective
from public.appearances a
left join public.role_aliases ra on ra.kind = 'role'       and ra.raw_value = a.role_name
left join public.role_aliases pa on pa.kind = 'production' and pa.raw_value = a.production_name
left join public.role_aliases sa on sa.kind = 'series'     and sa.raw_value = a.series_name;

-- ---------------------------------------------------------------------
-- Výbery a obľúbení
-- ---------------------------------------------------------------------

create table if not exists public.selections (
  id            bigint generated always as identity primary key,
  name          text not null,
  project_name  text,
  subtitle      text,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- on delete set null: odobratie používateľa nesmie zmazať jeho výbery.
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null
);

drop trigger if exists selections_updated_at on public.selections;
create trigger selections_updated_at before update on public.selections
  for each row execute function public.set_updated_at();

-- Poznámka patrí k dvojici výber + osoba, nie k osobe.
create table if not exists public.selection_items (
  selection_id  bigint not null references public.selections(id) on delete cascade,
  person_id     bigint not null references public.people(id) on delete cascade,
  note          text,
  sort_order    integer not null default 0,
  added_at      timestamptz not null default now(),
  added_by      uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (selection_id, person_id)
);

create index if not exists selection_items_person_idx on public.selection_items (person_id);

create or replace function public.touch_selection_from_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.selections
     set updated_at = now(), updated_by = auth.uid()
   where id = coalesce(new.selection_id, old.selection_id);
  return null;
end $$;

drop trigger if exists selection_items_touch on public.selection_items;
create trigger selection_items_touch after insert or update or delete on public.selection_items
  for each row execute function public.touch_selection_from_item();

drop trigger if exists selection_items_updated_at on public.selection_items;
create trigger selection_items_updated_at before update on public.selection_items
  for each row execute function public.set_updated_at();

create table if not exists public.favorites (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_id   bigint not null references public.people(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, person_id)
);

-- Zdieľané odkazy pre klienta (fáza 4 — zatiaľ len tabuľka).
create table if not exists public.share_links (
  id            uuid primary key default gen_random_uuid(),
  selection_id  bigint not null references public.selections(id) on delete cascade,
  expires_at    timestamptz not null check (expires_at <= created_at + interval '14 days'),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null
);

-- created_at a created_by určuje server, inak by sa dal obísť limit 14 dní
-- podvrhnutím created_at z klienta.
create or replace function public.share_links_server_fields()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.selection_id := old.selection_id;
    new.expires_at := least(new.expires_at, old.expires_at);
  end if;
  return new;
end $$;

drop trigger if exists share_links_server on public.share_links;
create trigger share_links_server before insert or update on public.share_links
  for each row execute function public.share_links_server_fields();

-- ---------------------------------------------------------------------
-- Záznam zmien
-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id, changed_at desc);

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id  text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) - 'updated_at' - 'updated_by' = to_jsonb(new) - 'updated_at' - 'updated_by' then
    return null;
  end if;
  v_id := coalesce(v_row->>'id',
                   (v_row->>'selection_id') || ':' || (v_row->>'person_id'));
  insert into public.audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_id, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['people','person_photos','appearances','selections','selection_items','role_aliases','app_users'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.write_audit_log()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Pohľady bez kontaktných údajov
-- Tieto pohľady bežia s právami vlastníka (obchádzajú RLS na people),
-- preto si prístup kontrolujú samé cez is_app_user(). Telefón, e-mail
-- a adresu NEOBSAHUJÚ — rola viewer ich takto nikdy nedostane.
-- ---------------------------------------------------------------------

create or replace view public.people_list as
select
  p.id,
  p.legacy_id,
  p.first_name,
  p.last_name,
  p.gender,
  p.birth_date,
  p.birth_date_approx,
  date_part('year', age(p.birth_date))::int as age,
  p.city,
  p.region,
  p.height_cm,
  p.clothing_size,
  p.shoe_size,
  p.hair_color,
  p.eye_color,
  p.has_tattoos,
  p.period_look,
  p.speaking_role,
  p.driving_licence,
  p.languages,
  p.skills,
  p.notes,
  p.is_active,
  p.last_contacted_at,
  p.created_at,
  ph.thumb_path,
  ph.taken_on as photo_taken_on,
  ph.storage_path as photo_path,
  coalesce(pc.photo_count, 0) as photo_count,
  coalesce(pr.registration_ids, '{}') as registration_ids
from public.people p
left join lateral (
  select x.thumb_path, x.storage_path, x.taken_on
  from public.person_photos x
  where x.person_id = p.id
  order by x.is_primary desc, x.sort_order, x.id
  limit 1
) ph on true
left join lateral (
  select count(*)::int as photo_count from public.person_photos x where x.person_id = p.id
) pc on true
left join lateral (
  select array_agg(r.registration_id order by r.registration_id) as registration_ids
  from public.person_registrations r where r.person_id = p.id
) pr on true
where (select public.is_app_user())
  and p.anonymized_at is null;

create or replace view public.people_detail as
select
  p.id, p.legacy_id, p.first_name, p.last_name, p.gender, p.birth_date, p.birth_date_approx,
  date_part('year', age(p.birth_date))::int as age,
  p.city, p.region, p.height_cm, p.clothing_size, p.shoe_size, p.hair_color, p.eye_color,
  p.has_tattoos, p.tattoo_note, p.languages, p.driving_licence, p.skills,
  p.period_look, p.speaking_role, p.notes, p.is_active, p.anonymized_at,
  p.consent_at, p.last_contacted_at, p.created_at, p.updated_at, p.created_by, p.updated_by
from public.people p
where (select public.is_app_user());

-- Príslušnosť k registračným vlnám bez doplnkových odpovedí (extra).
create or replace view public.person_registrations_public as
select r.person_id, r.registration_id, r.responded_at, g.name as registration_name
from public.person_registrations r
join public.registrations g on g.id = r.registration_id
where (select public.is_app_user());

revoke all on public.people_list, public.people_detail, public.person_registrations_public from anon, public;
grant select on public.people_list, public.people_detail, public.person_registrations_public to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.app_users            enable row level security;
alter table public.people               enable row level security;
alter table public.person_photos        enable row level security;
alter table public.registrations        enable row level security;
alter table public.person_registrations enable row level security;
alter table public.productions          enable row level security;
alter table public.production_series    enable row level security;
alter table public.appearances          enable row level security;
alter table public.role_aliases         enable row level security;
alter table public.selections           enable row level security;
alter table public.selection_items      enable row level security;
alter table public.favorites            enable row level security;
alter table public.share_links          enable row level security;
alter table public.audit_log            enable row level security;

-- app_users: každý aktívny používateľ vidí kolegov (mená pri výberoch),
-- vlastný riadok vidí vždy; meniť smie len správca.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_app_user()));
drop policy if exists app_users_admin_write on public.app_users;
create policy app_users_admin_write on public.app_users for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- people: celý riadok (vrátane kontaktov) len pre casting a správcu.
-- Viewer číta cez pohľady people_list / people_detail.
drop policy if exists people_staff_select on public.people;
create policy people_staff_select on public.people for select to authenticated
  using ((select public.is_staff()));
drop policy if exists people_staff_insert on public.people;
create policy people_staff_insert on public.people for insert to authenticated
  with check ((select public.is_staff()));
drop policy if exists people_staff_update on public.people;
create policy people_staff_update on public.people for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
-- Žiadna DELETE politika: profily sa nemažú natvrdo.

-- Tabuľky čitateľné pre všetkých aktívnych, zapisovateľné pre casting.
do $$
declare t text;
begin
  foreach t in array array['person_photos','productions','production_series','appearances','role_aliases'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using ((select public.is_app_user()))', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check ((select public.is_staff()))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using ((select public.is_staff()))', t, t);
  end loop;
end $$;

-- Príslušnosť k vlne: celý riadok vrátane doplnkových odpovedí (extra — môžu
-- obsahovať druhý telefón, adresu a pod.) len pre casting a správcu.
-- Ostatní čítajú pohľad person_registrations_public (bez extra).
drop policy if exists person_registrations_read on public.person_registrations;
drop policy if exists person_registrations_staff_read on public.person_registrations;
create policy person_registrations_staff_read on public.person_registrations for select to authenticated
  using ((select public.is_staff()));
drop policy if exists person_registrations_insert on public.person_registrations;
create policy person_registrations_insert on public.person_registrations for insert to authenticated
  with check ((select public.is_staff()));
drop policy if exists person_registrations_update on public.person_registrations;
create policy person_registrations_update on public.person_registrations for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists person_registrations_delete on public.person_registrations;
create policy person_registrations_delete on public.person_registrations for delete to authenticated
  using ((select public.is_staff()));

-- Registračné vlny spravuje len správca.
drop policy if exists registrations_read on public.registrations;
create policy registrations_read on public.registrations for select to authenticated
  using ((select public.is_app_user()));
drop policy if exists registrations_admin on public.registrations;
create policy registrations_admin on public.registrations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Výbery: číta každý aktívny, upravuje casting, maže autor alebo správca.
drop policy if exists selections_read on public.selections;
create policy selections_read on public.selections for select to authenticated
  using ((select public.is_app_user()));
drop policy if exists selections_insert on public.selections;
create policy selections_insert on public.selections for insert to authenticated
  with check ((select public.is_staff()));
drop policy if exists selections_update on public.selections;
create policy selections_update on public.selections for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
drop policy if exists selections_delete on public.selections;
create policy selections_delete on public.selections for delete to authenticated
  using ((select public.is_admin()) or ((select public.is_staff()) and created_by = (select auth.uid())));

drop policy if exists selection_items_read on public.selection_items;
create policy selection_items_read on public.selection_items for select to authenticated
  using ((select public.is_app_user()));
drop policy if exists selection_items_write on public.selection_items;
create policy selection_items_write on public.selection_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Obľúbení: výhradne vlastné.
drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_app_user()))
  with check (user_id = (select auth.uid()) and (select public.is_app_user()));

-- Autora a čas vytvorenia nastavuje trigger; zrušiť odkaz smie ktokoľvek z castingu.
drop policy if exists share_links_staff on public.share_links;
create policy share_links_staff on public.share_links for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Záznam zmien: číta casting a správca, zapisujú len triggery.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select public.is_staff()));

-- ---------------------------------------------------------------------
-- GDPR: anonymizácia profilu (UC-16)
-- Zmažú sa kontakty, fotky a osobné údaje; záznam o účinkovaní zostane
-- ako anonymný. Vyčistí sa aj záznam zmien, inak by v ňom kontakty
-- zostali navždy. Vracia cesty súborov v úložisku, ktoré musí aplikácia
-- následne zmazať cez Storage API.
-- ---------------------------------------------------------------------

create or replace function public.anonymize_person(p_person_id bigint)
returns table (storage_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
  v_confirmed_ids text[];
  v_label text := 'Anonymizovaný profil #' || p_person_id;
begin
  if not public.is_admin() then
    raise exception 'Anonymizovať profil smie len správca.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'Profil neexistuje.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(x.path), '{}') into v_paths
  from (
    select ph.storage_path as path from public.person_photos ph where ph.person_id = p_person_id
    union all
    select ph.thumb_path from public.person_photos ph where ph.person_id = p_person_id and ph.thumb_path is not null
  ) x;

  delete from public.person_photos        where person_id = p_person_id;
  delete from public.favorites            where person_id = p_person_id;
  delete from public.selection_items      where person_id = p_person_id;
  delete from public.person_registrations where person_id = p_person_id;

  update public.people set
    first_name = 'Anonymizovaný', last_name = 'profil #' || id,
    gender = null, birth_date = null, birth_date_approx = false,
    phone = null, email = null, address = null, city = null, region = null,
    height_cm = null, clothing_size = null, shoe_size = null,
    hair_color = null, eye_color = null, has_tattoos = false, tattoo_note = null,
    languages = '{}', skills = '{}', driving_licence = false,
    period_look = false, speaking_role = false, notes = null,
    is_active = false, consent_at = null, last_contacted_at = null,
    anonymized_at = now()
  where id = p_person_id;

  -- Meno v archíve prepisujeme len pri POTVRDENÝCH záznamoch — tie isto patria
  -- tejto osobe. Navrhnuté záznamy môžu patriť inému človeku s podobným menom
  -- (menovci): tie len odpojíme, meno zo súpisky ostáva.
  select coalesce(array_agg(a.id::text), '{}') into v_confirmed_ids
  from public.appearances a
  where a.person_id = p_person_id and a.match_status = 'confirmed';

  perform set_config('komparz.anonymizing', 'on', true);
  update public.appearances set raw_name = v_label, name_override = null
  where person_id = p_person_id and match_status = 'confirmed';
  perform set_config('komparz.anonymizing', 'off', true);

  update public.appearances set match_status = 'unmatched'
  where person_id = p_person_id and match_status = 'suggested';

  update public.audit_log set
    old_data = case when old_data is null then null else jsonb_build_object('anonymized', true) end,
    new_data = case when new_data is null then null else jsonb_build_object('anonymized', true) end
  where (table_name = 'people' and row_id = p_person_id::text)
     or (table_name = 'person_photos'
         and (old_data->>'person_id' = p_person_id::text or new_data->>'person_id' = p_person_id::text))
     or (table_name = 'appearances' and row_id = any (v_confirmed_ids))
     or (table_name = 'selection_items' and row_id like '%:' || p_person_id::text);

  return query select unnest(v_paths);
end $$;

-- ---------------------------------------------------------------------
-- Oprávnenia na úrovni objektov
-- ---------------------------------------------------------------------

-- Anonymný prístup nemá k ničomu — ani k tabuľkám a pohľadom, ktoré pribudnú
-- v neskorších migráciách (Supabase ich inak automaticky sprístupní roli anon).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Funkcie (RPC) smie volať len prihlásený používateľ.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function public.current_app_role(), public.is_app_user(), public.is_staff(),
  public.is_admin(), public.anonymize_person(bigint) to authenticated;

-- app_users: správca smie meniť len meno, rolu a aktívnosť — nie id ani e-mail
-- (e-mail sa mení cez Supabase Auth). Vkladá a maže výhradne trigger / Auth.
revoke insert, update, delete, truncate on public.app_users from authenticated;
grant update (full_name, role, is_active) on public.app_users to authenticated;

-- Záznam zmien zapisujú výhradne triggery.
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke truncate on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------
-- Úložisko fotografií (neverejné)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('person-photos', 'person-photos', false, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do update set public = false;

drop policy if exists person_photos_storage_read on storage.objects;
create policy person_photos_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'person-photos' and (select public.is_app_user()));
drop policy if exists person_photos_storage_insert on storage.objects;
create policy person_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'person-photos' and (select public.is_staff()));
drop policy if exists person_photos_storage_update on storage.objects;
create policy person_photos_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'person-photos' and (select public.is_staff()))
  with check (bucket_id = 'person-photos' and (select public.is_staff()));
drop policy if exists person_photos_storage_delete on storage.objects;
create policy person_photos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'person-photos' and (select public.is_staff()));

-- ---------------------------------------------------------------------
-- Realtime pre spoločnú prácu na výberoch a v archíve
-- Supabase Realtime posiela zmeny len tým, ktorí riadok smú čítať podľa RLS.
-- Do publikácie preto patria len tabuľky bez kontaktných údajov.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  -- Po jednej tabuľke: pri opakovanom spustení by spoločný príkaz zlyhal
  -- na prvej už pridanej a ďalšie by sa nepridali.
  foreach t in array array['selections', 'selection_items', 'appearances'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then
        raise notice 'Publikácia supabase_realtime neexistuje — realtime zapnite v Database → Replication.';
        exit;
    end;
  end loop;
end $$;
