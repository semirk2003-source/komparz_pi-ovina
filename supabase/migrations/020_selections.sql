-- =====================================================================
-- Výbery — atomické vytvorenie výberu aj s položkami.
-- Spúšťa sa po 001_schema.sql.
-- =====================================================================

-- Uloží hlavičku výberu a všetky položky v jednej transakcii: buď sa
-- uloží celý výber, alebo nič (žiadne neúplné výbery po chybe siete).
-- security invoker → platia prístupové pravidlá volajúceho (len casting/správca).
-- p_items: [{ "person_id": 123, "note": "…" }, …] v poradí, v akom sa majú zobraziť.
create or replace function public.create_selection_with_items(
  p_name          text,
  p_project_name  text default null,
  p_subtitle      text default null,
  p_items         jsonb default '[]'::jsonb
)
returns public.selections
language plpgsql security invoker set search_path = public as $$
declare
  v_selection public.selections;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Výber musí mať názov.' using errcode = 'check_violation';
  end if;

  insert into public.selections (name, project_name, subtitle)
  values (btrim(p_name), nullif(btrim(p_project_name), ''), nullif(btrim(p_subtitle), ''))
  returning * into v_selection;

  insert into public.selection_items (selection_id, person_id, note, sort_order)
  select v_selection.id,
         (x.item->>'person_id')::bigint,
         nullif(btrim(x.item->>'note'), ''),
         (x.ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(item, ord)
  where x.item->>'person_id' is not null
  on conflict (selection_id, person_id) do nothing;

  return v_selection;
end $$;

revoke all on function public.create_selection_with_items(text, text, text, jsonb) from public, anon;
grant execute on function public.create_selection_with_items(text, text, text, jsonb) to authenticated;
