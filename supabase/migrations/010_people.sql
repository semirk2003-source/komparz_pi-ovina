-- =====================================================================
-- Komparz Stupák — oblasť Ľudia
-- Spúšťa sa po 001_schema.sql.
--
-- Anonymizácia profilu (UC-16) je definovaná v 001_schema.sql ako
-- public.anonymize_person(bigint) returns table (storage_path text).
-- Tu ju zámerne neredefinujeme, aby sa neprepísala jednoduchšou verziou.
-- =====================================================================

-- Rýchle načítanie fotiek profilu v poradí, v akom sa zobrazujú v galérii.
create index if not exists person_photos_gallery_idx
  on public.person_photos (person_id, is_primary desc, sort_order, id);

-- História zmien profilu: dopyt podľa person_id fotiek v JSON.
create index if not exists audit_log_photo_new_person_idx
  on public.audit_log ((new_data->>'person_id'))
  where table_name = 'person_photos';
create index if not exists audit_log_photo_old_person_idx
  on public.audit_log ((old_data->>'person_id'))
  where table_name = 'person_photos';

-- Nastavenie hlavnej fotky v jednej transakcii. Jedinečný index povoľuje
-- len jednu hlavnú fotku na profil, preto najprv zrušíme ostatné a potom
-- nastavíme vybranú — profil tak nikdy neostane bez hlavnej fotky.
-- security invoker: platia RLS pravidlá volajúceho (upravovať smie len staff).
create or replace function public.set_primary_photo(p_photo_id bigint)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_person_id bigint;
begin
  select person_id into v_person_id from public.person_photos where id = p_photo_id;
  if v_person_id is null then
    raise exception 'Fotka sa nenašla.' using errcode = 'P0002';
  end if;

  update public.person_photos set is_primary = false
   where person_id = v_person_id and is_primary and id <> p_photo_id;

  update public.person_photos set is_primary = true where id = p_photo_id;
  if not found then
    raise exception 'Na úpravu fotiek nemáte oprávnenie.' using errcode = '42501';
  end if;
end $$;

revoke all on function public.set_primary_photo(bigint) from public, anon;
grant execute on function public.set_primary_photo(bigint) to authenticated;
