-- =====================================================================
-- Archív účinkovania — funkcie pre leaderboard, správu názvov a migráciu.
-- Spúšťa sa po 001_schema.sql.
-- =====================================================================

-- Leaderboard: agregácia potvrdených a nevyradených záznamov po osobách.
-- Ľudí bez účinkovania dopĺňa aplikácia zo zoznamu profilov.
-- security invoker → platia prístupové pravidlá volajúceho.
create or replace function public.archive_leaderboard(
  p_production text default null,
  p_series     text default null
)
returns table (
  person_id    bigint,
  shoot_days   int,
  records      int,
  first_date   date,
  last_date    date,
  productions  text[],
  series       text[]
)
language sql stable security invoker set search_path = public as $$
  select
    a.person_id,
    count(distinct a.shoot_date)::int,
    count(*)::int,
    min(a.shoot_date),
    max(a.shoot_date),
    coalesce(array_agg(distinct a.production_effective)
             filter (where a.production_effective is not null), '{}'),
    coalesce(array_agg(distinct a.production_effective || coalesce(' — ' || a.series_effective, ''))
             filter (where a.production_effective is not null), '{}')
  from public.appearances_effective a
  where a.match_status = 'confirmed'
    and not a.excluded_effective
    and a.person_id is not null
    and (p_production is null or a.production_effective = p_production)
    and (p_series is null or a.series_effective = p_series)
  group by a.person_id
$$;

-- Rôzne pôvodné hodnoty postáv / projektov / sérií s počtom výskytov.
create or replace function public.archive_name_values(p_kind text)
returns table (raw_value text, occurrences int)
language sql stable security invoker set search_path = public as $$
  select v, count(*)::int
  from (
    select case p_kind
             when 'role'       then a.role_name
             when 'production' then a.production_name
             when 'series'     then a.series_name
           end as v
    from public.appearances a
  ) x
  where v is not null
  group by v
$$;

-- Dvojice projekt + séria po zjednotení (pre filtre).
create or replace function public.archive_facets()
returns table (production text, series text)
language sql stable security invoker set search_path = public as $$
  select distinct a.production_effective, a.series_effective
  from public.appearances_effective a
  where not a.excluded_effective
$$;

revoke all on function public.archive_leaderboard(text, text) from public, anon;
revoke all on function public.archive_name_values(text) from public, anon;
revoke all on function public.archive_facets() from public, anon;
grant execute on function public.archive_leaderboard(text, text) to authenticated;
grant execute on function public.archive_name_values(text) to authenticated;
grant execute on function public.archive_facets() to authenticated;

-- ---------------------------------------------------------------------
-- Migrácia archívu (kapitola 5.5)
-- ---------------------------------------------------------------------

-- Normalizácia mena: bez diakritiky, malé písmená, len písmená a číslice, jedna medzera.
-- Zámerne bez rozšírenia unaccent: nezávisí od toho, do ktorej schémy je rozšírenie
-- nainštalované, ani od search_path volajúceho. Diakritika sa odstraňuje pred lower(),
-- lebo pri kolácii C lower() veľké písmená s diakritikou (Á, Č, Ž…) nezmení.
create or replace function public.archive_norm_name(p text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p, ''),
      'áäàâãåąčćçďđéěëèêęíìîïĺľłňńñóôöőòõøŕřšśşťţúůüűùûýÿžźżÁÄÀÂÃÅĄČĆÇĎĐÉĚËÈÊĘÍÌÎÏĹĽŁŇŃÑÓÔÖŐÒÕØŔŘŠŚŞŤŢÚŮÜŰÙÛÝŸŽŹŻ',
      'aaaaaaacccddeeeeeeiiiilllnnnooooooorrsssttuuuuuuyyzzzAAAAAAACCCDDEEEEEEIIIILLLNNNOOOOOOORRSSSTTUUUUUUYYZZZ')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Ochrana proti duplicite nezávislá od kolácie databázy.
-- Index appearances_no_duplicate (001) porovnáva cez lower(), ktorý pri kolácii C
-- nezmení veľké písmená s diakritikou: „RÝCHLY PRACHY / čašník" by prešlo vedľa
-- „Rýchly prachy / Čašník". Tento index porovnáva bez diakritiky a veľkosti písmen.
-- Rovnaký kľúč používa aj aplikácia (src/api/archive.js, exactDuplicateKey).
create unique index if not exists appearances_no_duplicate_norm on public.appearances (
  coalesce(person_id::text, 'raw:' || public.archive_norm_name(raw_name)),
  shoot_date,
  public.archive_norm_name(production_name),
  public.archive_norm_name(role_name)
) where not is_excluded;

-- Prepojí NEPRIRADENÉ záznamy na profily:
--   1. presná zhoda mena (aj v poradí priezvisko meno) práve s jedným profilom → confirmed
--      (kapitola 5.5); s p_auto_confirm_exact = false len suggested so skóre 1,
--   2. presná zhoda s viacerými profilmi (menovci) → suggested na prvého, rozhodne človek,
--   3. podobnosť (pg_trgm) ≥ p_threshold → suggested s match_score,
--   4. inak zostáva unmatched.
-- Nikdy nemení záznamy, ktoré už sú suggested alebo confirmed.
-- duplicate_count = záznamy, ktoré by po prepojení boli duplicitou už existujúceho
-- záznamu tej istej osoby (rovnaký deň, projekt, postava); zostávajú unmatched na posúdenie.
-- Spúšťa ju správca v SQL Editore alebo migrácia; aplikácia ju nevolá.
drop function if exists public.match_unmatched_appearances(real);
drop function if exists public.match_unmatched_appearances(real, boolean);
create function public.match_unmatched_appearances(
  p_threshold          real    default 0.5,
  p_auto_confirm_exact boolean default true
)
returns table (confirmed_count int, suggested_count int, unmatched_count int, duplicate_count int)
language plpgsql security invoker set search_path = public, extensions as $$
declare
  r        record;
  v_norm   text;
  v_ids    bigint[];
  v_best   record;
  v_conf   int := 0;
  v_sugg   int := 0;
  v_unm    int := 0;
  v_dup    int := 0;
begin
  perform set_config('pg_trgm.similarity_threshold', p_threshold::text, true);

  -- Funkcia sa môže v jednej transakcii volať opakovane.
  if to_regclass('pg_temp._archive_people') is not null then
    drop table pg_temp._archive_people;
  end if;
  create temp table _archive_people on commit drop as
    select p.id,
           public.archive_norm_name(p.first_name || ' ' || p.last_name) as n1,
           public.archive_norm_name(p.last_name || ' ' || p.first_name) as n2
    from public.people p
    where p.anonymized_at is null;
  create index on _archive_people (n1);
  create index on _archive_people (n2);
  create index on _archive_people using gin (n1 gin_trgm_ops);
  create index on _archive_people using gin (n2 gin_trgm_ops);
  analyze _archive_people;

  for r in
    select a.id, a.raw_name
    from public.appearances a
    where a.match_status = 'unmatched' and not a.is_excluded
    order by a.id
  loop
    v_norm := public.archive_norm_name(r.raw_name);

    select array_agg(distinct x.id order by x.id) into v_ids
    from _archive_people x
    where x.n1 = v_norm or x.n2 = v_norm;

    if coalesce(array_length(v_ids, 1), 0) >= 1 then
      begin
        update public.appearances
           set person_id = v_ids[1],
               match_status = case when array_length(v_ids, 1) = 1 and p_auto_confirm_exact
                                   then 'confirmed' else 'suggested' end,
               match_score = case when array_length(v_ids, 1) = 1 then 1 else 0.99 end
         where id = r.id;
        if array_length(v_ids, 1) = 1 and p_auto_confirm_exact then v_conf := v_conf + 1;
        else v_sugg := v_sugg + 1; end if;
      exception when unique_violation then
        v_dup := v_dup + 1;   -- záznam by bol duplicitou existujúceho — nechá sa na človeka
      end;
      continue;
    end if;

    select x.id, greatest(similarity(x.n1, v_norm), similarity(x.n2, v_norm)) as score
      into v_best
    from _archive_people x
    where x.n1 % v_norm or x.n2 % v_norm
    order by 2 desc, x.id
    limit 1;

    if found and v_best.score >= p_threshold then
      begin
        update public.appearances
           set person_id = v_best.id, match_status = 'suggested', match_score = v_best.score
         where id = r.id;
        v_sugg := v_sugg + 1;
      exception when unique_violation then
        v_dup := v_dup + 1;
      end;
    else
      v_unm := v_unm + 1;
    end if;
  end loop;

  return query select v_conf, v_sugg, v_unm, v_dup;
end $$;

revoke all on function public.match_unmatched_appearances(real, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pravidlá zjednocovania názvov — viac zmien naraz, atomicky
-- ---------------------------------------------------------------------

-- p_changes: [{ "raw_value": "...", "rule": { "canonical_value": "...", "is_excluded": false } | null }]
-- rule = null → pravidlo pre hodnotu sa zruší (hodnota sa vráti do pôvodného stavu).
-- Buď sa uložia všetky zmeny, alebo žiadna. Pôvodné hodnoty v archíve sa nemenia.
-- Pravidlá sa držia ploché (A→C, nie A→B→C); funkcia odmietne zmenu, ktorá by vytvorila reťazec.
create or replace function public.archive_apply_alias_changes(p_kind text, p_changes jsonb)
returns int language plpgsql security invoker set search_path = public as $$
declare
  c        jsonb;
  v_raw    text;
  v_canon  text;
  v_n      int := 0;
  v_raws   text[] := '{}';
begin
  if not public.is_staff() then
    raise exception 'Na túto akciu nemáte oprávnenie.' using errcode = '42501';
  end if;
  if p_kind not in ('role', 'production', 'series') then
    raise exception 'Neznámy druh názvu.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Zmeny musia byť zoznam.' using errcode = '22023';
  end if;

  for c in select * from jsonb_array_elements(p_changes) loop
    v_raw := c->>'raw_value';
    if v_raw is null then
      raise exception 'Chýba pôvodná hodnota.' using errcode = '22023';
    end if;
    v_raws := v_raws || v_raw;
    if c->'rule' is null or jsonb_typeof(c->'rule') = 'null' then
      delete from public.role_aliases where kind = p_kind and raw_value = v_raw;
    else
      v_canon := nullif(btrim(c->'rule'->>'canonical_value'), '');
      if v_canon = v_raw then v_canon := null; end if;
      insert into public.role_aliases (kind, raw_value, canonical_value, is_excluded)
      values (p_kind, v_raw, v_canon, coalesce((c->'rule'->>'is_excluded')::boolean, false))
      on conflict (kind, raw_value) do update
        set canonical_value = excluded.canonical_value, is_excluded = excluded.is_excluded;
    end if;
    v_n := v_n + 1;
  end loop;

  if exists (
    select 1
    from public.role_aliases a
    join public.role_aliases b
      on b.kind = a.kind and b.raw_value = a.canonical_value
     and b.canonical_value is not null
    where a.kind = p_kind
      and (a.raw_value = any (v_raws) or b.raw_value = any (v_raws))
  ) then
    raise exception 'Zmena by vytvorila reťazec pravidiel (A→B→C). Zlúčte hodnoty priamo pod konečný názov.'
      using errcode = '23514';
  end if;

  return v_n;
end $$;

revoke all on function public.archive_apply_alias_changes(text, jsonb) from public, anon;
grant execute on function public.archive_apply_alias_changes(text, jsonb) to authenticated;

-- Indexy pre filtre archívu a správu názvov.
create index if not exists appearances_role_name_idx on public.appearances (role_name);
create index if not exists appearances_production_name_idx on public.appearances (production_name, series_name);
