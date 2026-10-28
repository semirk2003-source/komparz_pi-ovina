-- =====================================================================
-- Komparz Stupák — migrácia dát z Excelu (kapitola 5 špecifikácie)
--
-- Postup:
--   1. Excel uložte ako CSV v kódovaní UTF-8 s hlavičkou podľa stĺpcov
--      tabuľky staging.people_raw (napr. legacy_id, meno_priezvisko, pohlavie…).
--      Stĺpce navyše pridajte do staging.people_raw ako text — uložia sa
--      k registračnej vlne ako doplnkové odpovede, nič sa nezahodí.
--   2. Table Editor → schéma staging → people_raw → Import data from CSV.
--   3. SQL Editor:  select * from public.migrate_people_from_staging('Pôvodný Excel');
--   4. Skontrolujte pohľady staging.migration_check_* (koniec súboru).
--   5. Archív: nahrajte CSV do staging.appearances_raw a spustite
--      select * from public.migrate_appearances_from_staging();
--      (bez automatického potvrdzovania presných zhôd: …_from_staging(false))
--
-- Prevod je opakovateľný: kotvou je legacy_id, opakované spustenie profily
-- aktualizuje, nevytvára kópie. Chybné riadky sa nikdy ticho nepreskočia —
-- zapíšu sa do staging.migration_errors aj s dôvodom.
-- Pravidlá čistenia zrkadlia src/lib/normalize.js — pri zmene upravte oboje.
--
-- Všetko v tomto súbore je dostupné len pre service_role / SQL Editor.
-- =====================================================================

set search_path = public, extensions;

create schema if not exists staging;
revoke all on schema staging from public, anon, authenticated;
grant usage on schema staging to service_role;

-- ---------------------------------------------------------------------
-- Dočasné tabuľky — všetko text, nič sa nekontroluje
-- ---------------------------------------------------------------------

create table if not exists staging.people_raw (
  _row_no          bigint generated always as identity primary key,
  legacy_id        text,
  meno_priezvisko  text,
  meno             text,
  priezvisko       text,
  pohlavie         text,
  datum_narodenia  text,
  vek              text,
  telefon          text,
  email            text,
  adresa           text,
  mesto            text,
  kraj             text,
  vyska            text,
  konfekcia        text,
  topanky          text,
  vlasy            text,
  oci              text,
  tetovanie        text,
  tetovanie_popis  text,
  jazyky           text,
  vodicak          text,
  zrucnosti        text,
  dobovy_vzhlad    text,
  textujuci        text,
  poznamky         text,
  registracia      text,
  odpovedal        text,
  suhlas           text,
  foto_odkaz       text  -- len na párovanie fotiek, do profilu sa neukladá
);

create table if not exists staging.appearances_raw (
  _row_no   bigint generated always as identity primary key,
  datum     text,
  meno      text,
  postava   text,
  projekt   text,
  seria     text,
  zdroj     text
);

create table if not exists staging.migration_runs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('people','appearances')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  created      integer not null default 0,
  updated      integer not null default 0,
  failed       integer not null default 0,
  skipped      integer not null default 0
);

create table if not exists staging.migration_errors (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references staging.migration_runs(id) on delete cascade,
  kind        text not null,
  row_no      bigint,
  legacy_id   text,
  severity    text not null check (severity in ('error','warning')),
  reason      text not null,
  raw         jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists migration_errors_run_idx on staging.migration_errors (run_id, severity);

revoke all on all tables in schema staging from public, anon, authenticated;
grant all on all tables in schema staging to service_role;

-- ---------------------------------------------------------------------
-- Čistiace funkcie (zrkadlo src/lib/normalize.js)
-- ---------------------------------------------------------------------

create or replace function staging.clean(p text)
returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(replace(coalesce(p, ''), chr(160), ' '), '\s+', ' ', 'g')), '')
$$;

create or replace function staging.norm(p text)
returns text language sql stable set search_path = public, extensions as $$
  select lower(unaccent(coalesce(staging.clean(p), '')))
$$;

-- Rozdelenie mena podľa poslednej medzery; text v zátvorke → poznámka.
create or replace function staging.split_name(
  p_raw text, out first_name text, out last_name text, out note text, out err text, out warn text
) language plpgsql stable as $$
declare
  t text := staging.clean(p_raw);
  idx int;
begin
  if t is null then err := 'Chýba meno.'; return; end if;
  if t ~ '[^\s@]+@[^\s@]+\.[^\s@]{2,}' or t ~ '\+?\d[\d\s/-]{7,}\d' then
    err := format('V poli pre meno je e-mail alebo telefón: „%s".', t); return;
  end if;
  select string_agg(btrim(m[1]), '; ') into note
    from regexp_matches(t, '[(\[]([^)\]]*)[)\]]', 'g') as m where btrim(m[1]) <> '';
  t := staging.clean(regexp_replace(t, '[(\[][^)\]]*[)\]]', ' ', 'g'));
  t := regexp_replace(t, '[,;]+$', '');
  if t is null or t = '' then err := 'Meno obsahuje len poznámku v zátvorke.'; return; end if;
  -- Formát „Priezvisko, Meno" (bežný v Exceli): pred čiarkou je priezvisko.
  if t ~ '^[^,]+,\s*[^,]+$' then
    last_name := btrim(split_part(t, ',', 1));
    first_name := btrim(split_part(t, ',', 2));
    warn := format('Meno v tvare „Priezvisko, Meno" — prevzaté ako %s %s.', first_name, last_name);
    return;
  end if;
  if strpos(t, ',') > 0 then
    err := format('Meno „%s" obsahuje viac čiarok — rozdeľte ho ručne.', t); return;
  end if;
  idx := length(t) - strpos(reverse(t), ' ') + 1;
  if strpos(t, ' ') = 0 then
    first_name := t; last_name := '';
    warn := format('Jednoslovné meno „%s" — skontrolujte.', t);
  else
    first_name := btrim(left(t, idx - 1));
    last_name := btrim(substr(t, idx + 1));
    if length(t) > 45 then warn := 'Meno je podozrivo dlhé — skontrolujte.'; end if;
  end if;
end $$;

create or replace function staging.parse_gender(p text)
returns text language plpgsql stable as $$
declare t text := staging.norm(p);
begin
  if t = '' then return null; end if;
  if t in ('z','zena','f','female','woman','zenske','zensky','dievca') or t like 'zen%' then return 'Žena'; end if;
  if t in ('m','muz','male','man','muzske','muzsky','chlapec') or t like 'muz%' then return 'Muž'; end if;
  return 'Iné';
end $$;

create or replace function staging.first_number(p text)
returns numeric language sql immutable as $$
  select (regexp_match(replace(coalesce(p, ''), ',', '.'), '(\d+(?:\.\d+)?)'))[1]::numeric
$$;

create or replace function staging.parse_shoe(p text, out value numeric, out err text)
language plpgsql immutable as $$
declare n numeric;
begin
  if staging.clean(p) is null then return; end if;
  n := staging.first_number(p);
  if n is null then err := format('Veľkosť topánok „%s" nie je číslo.', p); return; end if;
  if n < 15 or n > 55 then err := format('Veľkosť topánok %s je mimo rozsahu 15–55.', n); return; end if;
  value := round(n * 2) / 2;
end $$;

create or replace function staging.parse_height(p text, out value smallint, out err text)
language plpgsql immutable as $$
declare n numeric;
begin
  if staging.clean(p) is null then return; end if;
  n := staging.first_number(p);
  if n is null then err := format('Výška „%s" nie je číslo.', p); return; end if;
  if n > 0 and n < 3 then n := n * 100; end if;
  n := round(n);
  if n < 40 or n > 250 then err := format('Výška %s cm je mimo rozsahu 40–250.', n); return; end if;
  value := n::smallint;
end $$;

create or replace function staging.parse_size(p text)
returns text language plpgsql stable as $$
declare
  t text := replace(staging.norm(p), ' ', '');
  f text;
begin
  if t = '' then return null; end if;
  f := split_part(regexp_replace(t, '[-/,]', '|', 'g'), '|', 1);
  return case
    when f in ('xs') then 'XS' when f = 's' then 'S' when f = 'm' then 'M' when f = 'l' then 'L'
    when f = 'xl' then 'XL' when f in ('xxl','2xl') then 'XXL'
    when f in ('xxxl','3xl','4xl','xxxxl') then 'XXXL'
    else 'Iné/detské' end;
end $$;

create or replace function staging.parse_region(p_region text, p_city text)
returns text language plpgsql stable as $$
declare
  src text;
  k text;
  west  text[] := array['bratislav','trnav','nitr','trencin','trencian','pezinok','senec','malack','skalic','senic','piestan','galant','dunajsk','komarn','nove zamk','levice','topolcan','sala','hlohovec','myjav','nove mesto nad vahom','povazsk','prievidz','partizansk','ilav','puchov','zlate moravce','stupava','modra','zahor','zapad'];
  central text[] := array['bansk','zilin','martin','ruzomber','liptov','dolny kubin','cadc','zvolen','lucenec','rimavsk','brezn','zarnovic','ziar','kremnic','detv','poltar','revuc','velky krtis','turcian','kysuc','orav','tvrdosin','namestovo','stred'];
  east  text[] := array['kosic','presov','poprad','spis','michalov','humenn','bardejov','trebisov','roznav','kezmar','levoc','gelnic','sabinov','stara lubovn','vranov','svidnik','snin','sobranc','medzilaborc','stropkov','vychod'];
  czech text[] := array['cesk','cechy','cr','cz','czech','praha','brno','ostrav','olomouc','plzen','zlin','hodonin','breclav','uherske','liberec','pardubic','hradec','jihlav','opav','karvin','frydek'];
begin
  if staging.norm(p_region) = '' and staging.norm(p_city) = '' then return 'Iné / neuvedené'; end if;
  if staging.clean(p_region) in ('Západné Slovensko','Stredné Slovensko','Východné Slovensko','Česko','Iné / neuvedené') then
    return staging.clean(p_region);
  end if;
  foreach src in array array[staging.norm(p_region), staging.norm(p_city)] loop
    continue when src = '';
    foreach k in array czech loop
      if src = k or src like k || '%' or src like '% ' || k || '%' then return 'Česko'; end if;
    end loop;
    foreach k in array east loop if strpos(src, k) > 0 then return 'Východné Slovensko'; end if; end loop;
    foreach k in array central loop if strpos(src, k) > 0 then return 'Stredné Slovensko'; end if; end loop;
    foreach k in array west loop if strpos(src, k) > 0 then return 'Západné Slovensko'; end if; end loop;
  end loop;
  return 'Iné / neuvedené';
end $$;

create or replace function staging.make_date_safe(y int, m int, d int)
returns date language plpgsql immutable as $$
begin
  return make_date(y, m, d);
exception when others then
  return null;
end $$;

-- Dátum narodenia: d.m.yyyy, yyyy-mm-dd, d.m.yy, Excel sériové číslo, len vek, len rok.
create or replace function staging.parse_birth(p_date text, p_age text, out value date, out approx boolean, out err text, out warn text)
language plpgsql stable as $$
declare
  t text := staging.clean(p_date);
  a text := staging.clean(p_age);
  m text[];
  yy int;
begin
  approx := false;
  if t is null and a is not null then t := a; end if;
  if t is null then return; end if;

  if t ~ '^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}$' then
    m := regexp_match(t, '^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$');
    value := staging.make_date_safe(m[3]::int, m[2]::int, m[1]::int);
  elsif t ~ '^\d{4}-\d{1,2}-\d{1,2}' then
    m := regexp_match(t, '^(\d{4})-(\d{1,2})-(\d{1,2})');
    value := staging.make_date_safe(m[1]::int, m[2]::int, m[3]::int);
  elsif t ~ '^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2}$' then
    m := regexp_match(t, '^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$');
    yy := m[3]::int;
    yy := yy + case when 2000 + yy > extract(year from current_date) then 1900 else 2000 end;
    value := staging.make_date_safe(yy, m[2]::int, m[1]::int);
  elsif t ~ '^\d{5}(\.\d+)?$' then
    value := date '1899-12-30' + floor(t::numeric)::int;
  elsif t ~* '^\d{1,3}\s*(r|rok|roky|rokov|years?)?\.?$' then
    yy := (regexp_match(t, '^(\d{1,3})'))[1]::int;
    if yy > 0 and yy < 110 then
      value := make_date(extract(year from current_date)::int - yy, 1, 1);
      approx := true;
      warn := format('Uvedený len vek (%s) — dátum narodenia je približný.', yy);
      return;
    end if;
  elsif t ~ '^(19|20)\d{2}$' then
    value := make_date(t::int, 1, 1);
    approx := true;
    warn := 'Uvedený len rok narodenia — dátum je približný.';
    return;
  end if;

  if value is null then
    err := format('Dátum narodenia „%s" sa nepodarilo prečítať.', t);
  elsif value < date '1900-01-01' or value > current_date then
    err := format('Dátum narodenia %s je nereálny.', value);
    value := null;
  end if;
end $$;

create or replace function staging.parse_date_simple(p text)
returns date language sql stable as $$
  select (staging.parse_birth(p, null)).value
$$;

create or replace function staging.parse_phone(p text, out value text, out warn text)
language plpgsql immutable as $$
declare d text;
begin
  if staging.clean(p) is null then return; end if;
  d := regexp_replace(p, '[^\d+]', '', 'g');
  if d like '00%' then d := '+' || substr(d, 3); end if;
  if d ~ '^0\d{9}$' then d := '+421' || substr(d, 2);
  elsif d ~ '^9\d{8}$' then d := '+421' || d;
  elsif d ~ '^42[01]\d{9}$' then d := '+' || d;
  end if;
  if d !~ '^\+\d{9,15}$' then
    value := staging.clean(p);
    warn := format('Telefón „%s" má nezvyčajný tvar.', staging.clean(p));
  else
    value := d;
  end if;
end $$;

create or replace function staging.parse_email(p text, out value text, out err text)
language plpgsql immutable as $$
declare t text := lower(regexp_replace(coalesce(staging.clean(p), ''), '^mailto:', ''));
begin
  if t = '' then return; end if;
  if t !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    err := format('E-mail „%s" nemá platný tvar.', staging.clean(p));
  else
    value := t;
  end if;
end $$;

-- Prázdne aj neznáma hodnota (napr. „neviem") = null; pri zakladaní profilu sa doplní
-- „nie", pri neznámej hodnote volajúci zapíše upozornenie (zrkadlo parseBool v JS).
create or replace function staging.parse_bool(p text)
returns boolean language sql stable as $$
  select case
    when staging.norm(p) = '' then null
    when staging.norm(p) in ('ano','a','x','1','true','yes','y','ok','v') then true
    when staging.norm(p) in ('nie','n','0','false','no','-') then false
    else null end
$$;

-- Súhlas: dátum, alebo „áno" → dátum migrácie (s upozornením), „nie" → bez dátumu.
create or replace function staging.parse_consent(p text, out value date, out warn text)
language plpgsql stable as $$
declare t text := staging.clean(p);
begin
  if t is null then return; end if;
  if staging.parse_bool(t) is true then
    value := current_date;
    warn := format('Súhlas uvedený ako „%s" — uložený dátum migrácie.', t);
  elsif staging.parse_bool(t) is false then
    warn := format('Súhlas uvedený ako „%s" — dátum súhlasu nevyplnený.', t);
  else
    value := staging.parse_date_simple(t);
    if value is null then warn := format('Súhlas „%s" nie je dátum ani áno/nie — pole vynechané.', t); end if;
  end if;
end $$;

create or replace function staging.parse_list(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}')
  from regexp_split_to_table(coalesce(p, ''), '[,;/|]+') as x
$$;

-- ---------------------------------------------------------------------
-- Prevod profilov
-- ---------------------------------------------------------------------

drop function if exists public.migrate_people_from_staging(text);
create function public.migrate_people_from_staging(p_default_registration text default null)
returns table (run_id bigint, created integer, updated integer, skipped_edited integer, failed integer, warnings integer)
language plpgsql security definer set search_path = public, staging, extensions as $$
declare
  v_run bigint;
  r record;
  j jsonb;
  extra jsonb;
  known text[] := array['_row_no','legacy_id','meno_priezvisko','meno','priezvisko','pohlavie','datum_narodenia','vek',
    'telefon','email','adresa','mesto','kraj','vyska','konfekcia','topanky','vlasy','oci','tetovanie','tetovanie_popis',
    'jazyky','vodicak','zrucnosti','dobovy_vzhlad','textujuci','poznamky','registracia','odpovedal','suhlas','foto_odkaz'];
  v_legacy int;
  nm record; bd record; sh record; ht record; ph record; em record;
  v_first text; v_last text; v_notes text;
  v_errors text[]; v_warns text[];
  v_person bigint; v_inserted boolean; cs record;
  v_reg_name text; v_reg bigint;
  c_created int := 0; c_updated int := 0; c_skipped int := 0; c_failed int := 0; c_warn int := 0;
begin
  -- session_user (nie current_user — vo funkcii security definer je to vždy vlastník).
  if not (coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres','supabase_admin') or public.is_admin()) then
    raise exception 'Migráciu môže spustiť len správca.' using errcode = '42501';
  end if;

  insert into staging.migration_runs (kind) values ('people') returning id into v_run;

  for r in select * from staging.people_raw order by _row_no loop
    j := to_jsonb(r);
    v_errors := '{}'; v_warns := '{}';
    v_first := null; v_last := null; v_notes := staging.clean(r.poznamky);

    -- Kotva: pôvodné číslo z Excelu.
    begin
      v_legacy := nullif(regexp_replace(coalesce(r.legacy_id, ''), '\s', '', 'g'), '')::int;
    exception when others then
      v_legacy := null;
      v_errors := v_errors || format('Pôvodné číslo „%s" nie je celé číslo.', r.legacy_id);
    end;
    if v_legacy is null and cardinality(v_errors) = 0 then
      v_errors := v_errors || 'Chýba pôvodné číslo (legacy_id) — bez neho by opakovaný prevod vytvoril kópie.'::text;
    end if;
    if v_legacy is not null and exists (
      select 1 from staging.people_raw x
      where x._row_no < r._row_no and nullif(regexp_replace(coalesce(x.legacy_id, ''), '\s', '', 'g'), '') = v_legacy::text
    ) then
      v_errors := v_errors || format('Pôvodné číslo %s je v tabuľke viackrát.', v_legacy);
    end if;

    -- Meno
    if staging.clean(r.meno_priezvisko) is not null then
      nm := staging.split_name(r.meno_priezvisko);
      if nm.err is not null then v_errors := v_errors || nm.err; end if;
      if nm.warn is not null then v_warns := v_warns || nm.warn; end if;
      v_first := nm.first_name; v_last := nm.last_name;
      if nm.note is not null then
        v_notes := concat_ws(' | ', v_notes, nm.note);
        v_warns := v_warns || format('Poznámka zo zátvorky v mene presunutá do poznámok: „%s".', nm.note);
      end if;
    else
      v_first := coalesce(staging.clean(r.meno), '');
      v_last := coalesce(staging.clean(r.priezvisko), '');
      if v_first = '' and v_last = '' then v_errors := v_errors || 'Chýba meno.'::text; end if;
      if (v_first || v_last) ~ '@|\d{6,}' then v_errors := v_errors || 'V poli pre meno je e-mail alebo telefón.'::text; end if;
    end if;

    bd := staging.parse_birth(r.datum_narodenia, r.vek);
    sh := staging.parse_shoe(r.topanky);
    ht := staging.parse_height(r.vyska);
    ph := staging.parse_phone(r.telefon);
    em := staging.parse_email(r.email);
    -- Chyba jednotlivého poľa: pole sa vynechá, riadok sa prevezme a chyba sa zapíše ako upozornenie.
    if bd.err is not null then v_warns := v_warns || (bd.err || ' — pole vynechané'); end if;
    if bd.warn is not null then v_warns := v_warns || bd.warn; end if;
    if sh.err is not null then v_warns := v_warns || (sh.err || ' — pole vynechané'); end if;
    if ht.err is not null then v_warns := v_warns || (ht.err || ' — pole vynechané'); end if;
    if ph.warn is not null then v_warns := v_warns || ph.warn; end if;
    if em.err is not null then v_warns := v_warns || (em.err || ' — pole vynechané'); end if;
    cs := staging.parse_consent(r.suhlas);
    if cs.warn is not null then v_warns := v_warns || cs.warn; end if;
    declare
      b record;
    begin
      for b in select * from (values ('Tetovanie', r.tetovanie), ('Vodičský preukaz', r.vodicak),
                                     ('Dobový vzhľad', r.dobovy_vzhlad), ('Textujúci', r.textujuci)) v(label, val)
      loop
        if staging.clean(b.val) is not null and staging.parse_bool(b.val) is null then
          v_warns := v_warns || format('%s: hodnotu „%s" nevieme určiť ako áno/nie — uložené ako nie.', b.label, staging.clean(b.val));
        end if;
      end loop;
    end;

    if cardinality(v_errors) > 0 then
      insert into staging.migration_errors (run_id, kind, row_no, legacy_id, severity, reason, raw)
      select v_run, 'people', r._row_no, r.legacy_id, 'error', e, j from unnest(v_errors) e;
      c_failed := c_failed + 1;
      continue;
    end if;

    v_person := null;
    begin
      insert into public.people as p (
        legacy_id, first_name, last_name, gender, birth_date, birth_date_approx, phone, email, address,
        city, region, height_cm, clothing_size, shoe_size, hair_color, eye_color, has_tattoos, tattoo_note,
        languages, driving_licence, skills, period_look, speaking_role, notes, consent_at
      ) values (
        v_legacy, v_first, v_last, staging.parse_gender(r.pohlavie), bd.value, coalesce(bd.approx, false), ph.value, em.value,
        staging.clean(r.adresa), staging.clean(r.mesto), staging.parse_region(r.kraj, r.mesto), ht.value,
        staging.parse_size(r.konfekcia), sh.value, staging.clean(r.vlasy), staging.clean(r.oci),
        coalesce(staging.parse_bool(r.tetovanie), false) or staging.clean(r.tetovanie_popis) is not null, staging.clean(r.tetovanie_popis),
        staging.parse_list(r.jazyky), coalesce(staging.parse_bool(r.vodicak), false), staging.parse_list(r.zrucnosti),
        coalesce(staging.parse_bool(r.dobovy_vzhlad), false), coalesce(staging.parse_bool(r.textujuci), false), v_notes, cs.value
      )
      on conflict (legacy_id) do update set
        first_name = excluded.first_name, last_name = excluded.last_name, gender = excluded.gender,
        birth_date = excluded.birth_date, birth_date_approx = excluded.birth_date_approx,
        phone = excluded.phone, email = excluded.email, address = excluded.address, city = excluded.city,
        region = excluded.region, height_cm = excluded.height_cm, clothing_size = excluded.clothing_size,
        shoe_size = excluded.shoe_size, hair_color = excluded.hair_color, eye_color = excluded.eye_color,
        has_tattoos = excluded.has_tattoos, tattoo_note = excluded.tattoo_note, languages = excluded.languages,
        driving_licence = excluded.driving_licence, skills = excluded.skills, period_look = excluded.period_look,
        speaking_role = excluded.speaking_role, notes = excluded.notes,
        consent_at = coalesce(excluded.consent_at, p.consent_at)
      -- Profil už upravený v aplikácii sa opakovanou migráciou neprepíše.
      where p.updated_by is null
      returning p.id, (p.xmax = 0) into v_person, v_inserted;
    exception when others then
      insert into staging.migration_errors (run_id, kind, row_no, legacy_id, severity, reason, raw)
      values (v_run, 'people', r._row_no, r.legacy_id, 'error', 'Databáza riadok odmietla: ' || sqlerrm, j);
      c_failed := c_failed + 1;
      continue;
    end;

    if v_person is null then
      insert into staging.migration_errors (run_id, kind, row_no, legacy_id, severity, reason, raw)
      values (v_run, 'people', r._row_no, r.legacy_id, 'warning',
              'Profil bol medzitým upravený v aplikácii — migrácia ho preskočila (neprepisuje sa).', j);
      c_skipped := c_skipped + 1;
      continue;
    end if;
    if v_inserted then c_created := c_created + 1; else c_updated := c_updated + 1; end if;

    if cardinality(v_warns) > 0 then
      insert into staging.migration_errors (run_id, kind, row_no, legacy_id, severity, reason, raw)
      select v_run, 'people', r._row_no, r.legacy_id, 'warning', w, j from unnest(v_warns) w;
      c_warn := c_warn + 1;
    end if;

    -- Registračná vlna + stĺpce navyše ako doplnkové odpovede.
    v_reg_name := coalesce(staging.clean(r.registracia), staging.clean(p_default_registration));
    if v_reg_name is not null then
      insert into public.registrations (name) values (v_reg_name)
      on conflict (name) do update set name = excluded.name
      returning id into v_reg;

      -- Doplnkové odpovede vidí len casting a správca (RLS), napriek tomu sa stĺpce,
      -- ktoré vyzerajú na kontakt alebo citlivý údaj, do nich nepreberú
      -- (zostanú len v staging.people_raw, ktorá sa po migrácii maže).
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into extra
      from jsonb_each(j)
      where key <> all (known) and staging.clean(value #>> '{}') is not null
        and staging.norm(key) !~ '(tel|mobil|phone|mail|adres|ulica|psc|iban|ucet|rodne|heslo|password)';

      insert into public.person_registrations (person_id, registration_id, responded_at, extra)
      values (v_person, v_reg, staging.parse_date_simple(r.odpovedal), extra)
      on conflict (person_id, registration_id) do update set
        responded_at = coalesce(excluded.responded_at, person_registrations.responded_at),
        extra = person_registrations.extra || excluded.extra;
    end if;
  end loop;

  update staging.migration_runs
     set finished_at = now(), created = c_created, updated = c_updated, skipped = c_skipped, failed = c_failed
   where id = v_run;

  return query select v_run, c_created, c_updated, c_skipped, c_failed, c_warn;
end $$;

-- ---------------------------------------------------------------------
-- Prevod archívu účinkovania
-- ---------------------------------------------------------------------

-- p_auto_confirm_exact = false: aj presná zhoda s jediným profilom bude len navrhnutá
-- (README 4.3 — ochrana pred menovcom, ktorý v databáze nie je).
drop function if exists public.migrate_appearances_from_staging();
drop function if exists public.migrate_appearances_from_staging(boolean);
create function public.migrate_appearances_from_staging(p_auto_confirm_exact boolean default true)
returns table (run_id bigint, created integer, skipped_duplicates integer, failed integer,
               confirmed integer, suggested integer, unmatched integer, duplicate_on_match integer, matched_note text)
language plpgsql security definer set search_path = public, staging, extensions as $$
declare
  v_run bigint;
  r record;
  v_date date;
  v_name text;
  c_created int := 0; c_dup int := 0; c_failed int := 0;
  v_note text;
  m record;
begin
  -- session_user (nie current_user — vo funkcii security definer je to vždy vlastník).
  if not (coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres','supabase_admin') or public.is_admin()) then
    raise exception 'Migráciu môže spustiť len správca.' using errcode = '42501';
  end if;

  insert into staging.migration_runs (kind) values ('appearances') returning id into v_run;

  for r in select * from staging.appearances_raw order by _row_no loop
    v_name := staging.clean(r.meno);
    v_date := (staging.parse_birth(r.datum, null)).value;
    if v_name is null or v_date is null then
      insert into staging.migration_errors (run_id, kind, row_no, severity, reason, raw)
      values (v_run, 'appearances', r._row_no, 'error',
              case when v_name is null then 'Chýba meno.' else format('Dátum „%s" sa nepodarilo prečítať.', r.datum) end,
              to_jsonb(r));
      c_failed := c_failed + 1;
      continue;
    end if;

    -- Opakovateľnosť: rovnaké pôvodné meno + dátum + projekt + postava sa nevloží druhýkrát.
    if exists (
      select 1 from public.appearances a
      where lower(a.raw_name) = lower(v_name) and a.shoot_date = v_date
        and lower(coalesce(a.original_production_name, '')) = lower(coalesce(staging.clean(r.projekt), ''))
        and lower(coalesce(a.original_role_name, '')) = lower(coalesce(staging.clean(r.postava), ''))
    ) then
      c_dup := c_dup + 1;
      continue;
    end if;

    begin
      insert into public.appearances (raw_name, shoot_date, role_name, production_name, series_name, source, match_status)
      values (v_name, v_date, staging.clean(r.postava), staging.clean(r.projekt), staging.clean(r.seria),
              coalesce(staging.clean(r.zdroj), 'migrácia'), 'unmatched');
      c_created := c_created + 1;
    exception when others then
      insert into staging.migration_errors (run_id, kind, row_no, severity, reason, raw)
      values (v_run, 'appearances', r._row_no, 'error', 'Databáza riadok odmietla: ' || sqlerrm, to_jsonb(r));
      c_failed := c_failed + 1;
    end;
  end loop;

  -- Katalóg projektov a sérií.
  insert into public.productions (name)
  select distinct production_name from public.appearances where production_name is not null
  on conflict (name) do nothing;
  insert into public.production_series (production_id, name)
  select distinct p.id, a.series_name
  from public.appearances a join public.productions p on p.name = a.production_name
  where a.series_name is not null
  on conflict (production_id, name) do nothing;

  -- Prepojenie na profily: presná jednoznačná zhoda = confirmed, podobnosť = len suggested.
  begin
    select * into m from public.match_unmatched_appearances(p_auto_confirm_exact => p_auto_confirm_exact);
    v_note := 'Prepojenie na profily prebehlo (návrhy treba potvrdiť v Archíve).';
  exception when undefined_function then
    v_note := 'Funkcia match_unmatched_appearances() chýba — spustite najprv 030_archive.sql.';
  end;

  update staging.migration_runs
     set finished_at = now(), created = c_created, skipped = c_dup, failed = c_failed
   where id = v_run;

  return query select v_run, c_created, c_dup, c_failed,
    m.confirmed_count, m.suggested_count, m.unmatched_count, m.duplicate_count, v_note;
end $$;

-- ---------------------------------------------------------------------
-- Dávková aktualizácia profilov pri importe registračnej vlny (aplikácia).
-- Každý prvok poľa: { id, <len zmenené polia> }. Chýbajúce kľúče sa nemenia.
-- security invoker → platia prístupové pravidlá volajúceho (len casting/správca).
-- Chyba jedného riadku nezastaví ostatné; vráti sa pri ňom ok = false.
-- ---------------------------------------------------------------------

create or replace function public.bulk_update_people(p_rows jsonb)
returns table (id bigint, ok boolean, error text)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  elem jsonb;
  v_id bigint;
  v_old public.people;
  v_new public.people;
  v_patch jsonb;
  allowed constant text[] := array['first_name','last_name','gender','birth_date','birth_date_approx','phone','email',
    'address','city','region','height_cm','clothing_size','shoe_size','hair_color','eye_color','has_tattoos','tattoo_note',
    'languages','driving_licence','skills','period_look','speaking_role','notes','consent_at'];
begin
  if not public.is_staff() then
    raise exception 'Na túto akciu nemáte oprávnenie.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Očakáva sa pole najviac 500 riadkov.' using errcode = '22023';
  end if;
  for elem in select value from jsonb_array_elements(p_rows) loop
    v_id := (elem->>'id')::bigint;
    begin
      select * into v_old from public.people p where p.id = v_id and p.anonymized_at is null for update;
      if not found then
        return query select v_id, false, 'Profil sa nenašiel, je anonymizovaný alebo chýba oprávnenie.'::text;
        continue;
      end if;
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
        from jsonb_each(elem) where key = any (allowed);
      v_new := jsonb_populate_record(v_old, v_patch);
      update public.people p set
        first_name = v_new.first_name, last_name = v_new.last_name, gender = v_new.gender,
        birth_date = v_new.birth_date, birth_date_approx = v_new.birth_date_approx,
        phone = v_new.phone, email = v_new.email, address = v_new.address, city = v_new.city, region = v_new.region,
        height_cm = v_new.height_cm, clothing_size = v_new.clothing_size, shoe_size = v_new.shoe_size,
        hair_color = v_new.hair_color, eye_color = v_new.eye_color, has_tattoos = v_new.has_tattoos,
        tattoo_note = v_new.tattoo_note, languages = v_new.languages, driving_licence = v_new.driving_licence,
        skills = v_new.skills, period_look = v_new.period_look, speaking_role = v_new.speaking_role,
        notes = v_new.notes, consent_at = v_new.consent_at
      where p.id = v_id;
      return query select v_id, true, null::text;
    exception when others then
      return query select v_id, false, sqlerrm;
    end;
  end loop;
end $$;

revoke all on function public.bulk_update_people(jsonb) from public, anon;
grant execute on function public.bulk_update_people(jsonb) to authenticated;

revoke all on function public.migrate_people_from_staging(text) from public, anon, authenticated;
revoke all on function public.migrate_appearances_from_staging(boolean) from public, anon, authenticated;
grant execute on function public.migrate_people_from_staging(text) to service_role;
grant execute on function public.migrate_appearances_from_staging(boolean) to service_role;

-- ---------------------------------------------------------------------
-- Kontrolné pohľady (kapitola 5.3, krok 5 a kontrolný zoznam 5.6)
-- ---------------------------------------------------------------------

create or replace view staging.migration_last_run as
select * from staging.migration_runs where kind = 'people' order by id desc limit 1;

-- 1. Koľko profilov je v databáze vs. koľko riadkov malo CSV.
create or replace view staging.migration_check_counts as
select
  (select count(*) from staging.people_raw)                                   as riadkov_v_csv,
  (select count(*) from public.people where legacy_id is not null)            as profilov_z_migracie,
  (select count(*) from public.people)                                        as profilov_spolu,
  (select count(distinct row_no) from staging.migration_errors e
     where e.run_id = (select id from staging.migration_last_run) and e.severity = 'error') as neprevzatych_riadkov,
  (select count(*) from staging.appearances_raw)                              as riadkov_archivu_v_csv,
  (select count(*) from public.appearances)                                   as zaznamov_archivu,
  (select count(*) from public.appearances where match_status = 'confirmed')  as archiv_potvrdene,
  (select count(*) from public.appearances where match_status = 'suggested')  as archiv_navrhnute,
  (select count(*) from public.appearances where match_status = 'unmatched')  as archiv_nepriradene;

-- 2. Koľkým chýba dátum narodenia (má to byť menšina).
create or replace view staging.migration_check_missing_birth_date as
select
  count(*) filter (where birth_date is null)                       as bez_datumu,
  count(*) filter (where birth_date_approx)                        as priblizny_datum,
  count(*)                                                         as spolu,
  round(100.0 * count(*) filter (where birth_date is null) / nullif(count(*), 0), 1) as percent_bez_datumu
from public.people;

-- 3. Ktoré riadky sa neprevzali a prečo (posledný beh), plus upozornenia.
create or replace view staging.migration_check_errors as
select e.kind, e.severity, e.row_no, e.legacy_id, e.reason, e.raw
from staging.migration_errors e
where e.run_id in (select max(id) from staging.migration_runs group by kind)
order by e.kind, e.severity, e.row_no;

-- 4. Podozrivé mená: jednoslovné alebo dlhšie ako 45 znakov.
create or replace view staging.migration_check_suspicious_names as
select id, legacy_id, first_name, last_name,
  case when coalesce(last_name, '') = '' or coalesce(first_name, '') = '' then 'jednoslovné meno'
       else 'meno dlhšie ako 45 znakov' end as dovod
from public.people
where coalesce(last_name, '') = '' or coalesce(first_name, '') = ''
   or length(first_name || ' ' || last_name) > 45
order by legacy_id;

-- 5. Nikto nie je v databáze dvakrát omylom: rovnaké meno + dátum narodenia.
create or replace view staging.migration_check_same_name_birth as
select lower(unaccent(first_name || ' ' || last_name)) as meno, birth_date,
       count(*) as pocet, array_agg(id order by id) as id_profilov, array_agg(legacy_id order by id) as povodne_cisla
from public.people
where birth_date is not null
group by 1, 2
having count(*) > 1
order by pocet desc, meno;

revoke all on all tables in schema staging from public, anon, authenticated;
grant select on all tables in schema staging to service_role;
grant all on staging.people_raw, staging.appearances_raw to service_role;

-- ---------------------------------------------------------------------
-- Registračná vlna s priradenými ľuďmi sa nesmie zmazať (cascade by
-- zmazal informáciu, odkiaľ ľudia prišli).
-- ---------------------------------------------------------------------

create or replace function public.registrations_prevent_delete()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.person_registrations where registration_id = old.id) then
    raise exception 'Vlnu nemožno zmazať, sú v nej ľudia.' using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists registrations_no_delete_with_people on public.registrations;
create trigger registrations_no_delete_with_people before delete on public.registrations
  for each row execute function public.registrations_prevent_delete();
