-- Extend the fixed History event vocabulary with Color Change and SC Start.
-- Preferences affect live marking only; saved marks remain editable.
-- Existing ids stay: only time_sec and temp_c may change. No deletes, no type/id swaps,
-- no new Charge/Drop/End. Order and the 0–400°C band apply when a time moves or a row is new,
-- so a saved oddity can still be written back unchanged (Heat-only saves send the same events).
-- New-event time cap is 99:59, matching ADDABLE_KEY_EVENTS / the m:ss field in record-edit.ts.
-- Raw TSV and inventory ledgers are still untouched.

create or replace function public.update_roast_session_record(
  p_session_id uuid,
  p_expected_events jsonb,
  p_expected_heater_events jsonb,
  p_events jsonb,
  p_heater_events jsonb,
  p_drop_temp_celsius integer,
  p_duration_seconds integer,
  p_profile_summary jsonb
) returns public.roast_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.roast_sessions;
  v_new public.roast_sessions;
begin
  select * into v_old from public.roast_sessions where id = p_session_id for update;
  if not found then
    raise exception 'roast_record_not_found' using errcode = 'PT404';
  end if;
  if v_old.status <> 'completed' then
    raise exception 'roast_record_not_completed' using errcode = 'PT422';
  end if;
  if v_old.events is distinct from p_expected_events
     or v_old.heater_events is distinct from p_expected_heater_events then
    raise exception 'roast_record_conflict' using errcode = 'PT409';
  end if;

  if jsonb_typeof(p_events) is distinct from 'array'
     or (v_old.events is not null and jsonb_typeof(v_old.events) is distinct from 'array') then
    raise exception 'roast_record_invalid_events' using errcode = 'PT422';
  end if;

  if exists (
    with old_e as (
      select e, e->>'id' as id
      from jsonb_array_elements(coalesce(v_old.events, '[]'::jsonb)) as t(e)
    ),
    new_e as (
      select e, e->>'id' as id
      from jsonb_array_elements(p_events) as t(e)
    )
    select 1
    from (
      select 1
      from new_e n
      where jsonb_typeof(n.e) is distinct from 'object'
         or jsonb_typeof(n.e -> 'id') is distinct from 'string'
         or n.id = ''
         or (select count(*) from new_e n2 where n2.id = n.id) <> 1
      union all
      select 1
      from old_e o
      where jsonb_typeof(o.e) is distinct from 'object'
         or jsonb_typeof(o.e -> 'id') is distinct from 'string'
         or o.id = ''
         or (select count(*) from new_e n where n.id = o.id) <> 1
      union all
      select 1
      from new_e n
      join old_e o on o.id = n.id
      where jsonb_typeof(n.e) = 'object'
        and jsonb_typeof(o.e) = 'object'
        and (
          (coalesce(o.e ->> 'type', '') not in ('Charge', 'TP', 'Yellow', 'Color Change', 'FC Start', 'FC Rolling', 'FC End', 'SC Start', 'Drop', 'End')
           and n.e is distinct from o.e)
          or (n.e - 'time_sec' - 'temp_c') is distinct from (o.e - 'time_sec' - 'temp_c')
          or case
               when jsonb_typeof(n.e -> 'time_sec') is distinct from 'number' then true
               when (n.e ->> 'time_sec')::numeric < 0 then true
               when o.e ->> 'type' = 'Charge'
                    and (n.e -> 'time_sec') is distinct from (o.e -> 'time_sec')
                    and (n.e ->> 'time_sec')::numeric <> 0 then true
               else false
             end
          or case
               when (n.e -> 'temp_c') is not distinct from (o.e -> 'temp_c') then false
               when not (n.e ? 'temp_c') or jsonb_typeof(n.e -> 'temp_c') = 'null' then false
               when jsonb_typeof(n.e -> 'temp_c') is distinct from 'number' then true
               when (n.e ->> 'temp_c')::numeric < 0 or (n.e ->> 'temp_c')::numeric > 400 then true
               else false
             end
        )
      union all
      select 1
      from new_e n
      where not exists (select 1 from old_e o where o.id is not null and o.id = n.id)
        and case
              when jsonb_typeof(n.e) is distinct from 'object' then true
              when coalesce(n.e ->> 'type', '') not in ('TP', 'Yellow', 'Color Change', 'FC Start', 'FC Rolling', 'FC End', 'SC Start') then true
              when exists (
                select 1 from jsonb_object_keys(n.e) as k(key)
                where k.key not in ('id', 'type', 'time_sec', 'temp_c')
              ) then true
              when jsonb_typeof(n.e -> 'time_sec') is distinct from 'number' then true
              when (n.e ->> 'time_sec')::numeric < 0 or (n.e ->> 'time_sec')::numeric > 5999 then true
              when n.e ? 'temp_c' and jsonb_typeof(n.e -> 'temp_c') not in ('number', 'null') then true
              when jsonb_typeof(n.e -> 'temp_c') = 'number'
                   and ((n.e ->> 'temp_c')::numeric < 0 or (n.e ->> 'temp_c')::numeric > 400) then true
              when exists (select 1 from old_e o where o.e ->> 'type' = n.e ->> 'type') then true
              when (
                select count(*)
                from new_e n2
                where jsonb_typeof(n2.e) = 'object'
                  and n2.e ->> 'type' = n.e ->> 'type'
                  and not exists (select 1 from old_e o where o.id is not null and o.id = n2.id)
              ) > 1 then true
              else false
            end
    ) bad
  ) then
    raise exception 'roast_record_invalid_events' using errcode = 'PT422';
  end if;

  -- Key-mark order. Equal times are allowed. An inversion already stored is left alone
  -- until a changed or new time is part of the pair.
  if exists (
    with old_e as (
      select e->>'id' as id, e->'time_sec' as time_sec
      from jsonb_array_elements(coalesce(v_old.events, '[]'::jsonb)) as t(e)
    ),
    ev as (
      select
        case n.e ->> 'type'
          when 'Charge' then 0
          when 'TP' then 1
          when 'Yellow' then 2
          when 'Color Change' then 3
          when 'FC Start' then 4
          when 'FC Rolling' then 5
          when 'FC End' then 6
          when 'SC Start' then 7
          when 'Drop' then 8
          when 'End' then 9
          else null
        end as rnk,
        (n.e ->> 'time_sec')::numeric as t,
        (
          not exists (select 1 from old_e o where o.id = n.e ->> 'id')
          or exists (
            select 1 from old_e o
            where o.id = n.e ->> 'id'
              and o.time_sec is distinct from (n.e -> 'time_sec')
          )
        ) as touched
      from jsonb_array_elements(p_events) as n(e)
      where jsonb_typeof(n.e) = 'object'
        and jsonb_typeof(n.e -> 'time_sec') = 'number'
        and n.e ->> 'type' in ('Charge', 'TP', 'Yellow', 'Color Change', 'FC Start', 'FC Rolling', 'FC End', 'SC Start', 'Drop', 'End')
    )
    select 1
    from ev a
    join ev b on a.rnk < b.rnk and a.t > b.t and (a.touched or b.touched)
  ) then
    raise exception 'roast_record_invalid_events' using errcode = 'PT422';
  end if;

  if p_heater_events is not null and jsonb_typeof(p_heater_events) <> 'array' then
    raise exception 'roast_record_invalid_heater' using errcode = 'PT422';
  end if;

  update public.roast_sessions
  set events = p_events,
      heater_events = p_heater_events,
      drop_temp_celsius = p_drop_temp_celsius,
      duration_seconds = p_duration_seconds,
      updated_at = now()
  where id = p_session_id
  returning * into v_new;

  if p_profile_summary is not null then
    update public.roast_profiles
    set charge_temp_celsius = (p_profile_summary ->> 'charge_temp_celsius')::integer,
        drop_temp_celsius = (p_profile_summary ->> 'drop_temp_celsius')::integer,
        duration_sec = (p_profile_summary ->> 'duration_sec')::integer,
        dev_time_sec = (p_profile_summary ->> 'dev_time_sec')::integer,
        dev_pct = (p_profile_summary ->> 'dev_pct')::real,
        updated_at = now()
    where source_session_id = p_session_id;
  end if;

  return v_new;
end;
$$;

comment on function public.update_roast_session_record(uuid, jsonb, jsonb, jsonb, jsonb, integer, integer, jsonb) is
  'History edit of a completed roast. Existing event ids may change time_sec/temp_c only. New rows may add one TP, Yellow, Color Change, FC Start, FC Rolling, FC End, or SC Start. Deletes, type changes, and new Charge/Drop/End are rejected.';

revoke execute on function public.update_roast_session_record(uuid, jsonb, jsonb, jsonb, jsonb, integer, integer, jsonb) from public, anon;
grant execute on function public.update_roast_session_record(uuid, jsonb, jsonb, jsonb, jsonb, integer, integer, jsonb) to authenticated;
