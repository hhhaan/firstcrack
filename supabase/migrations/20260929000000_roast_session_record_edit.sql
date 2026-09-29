-- #623 History edit of a saved roast: key event time/temp + Heat set plan.
-- heater_events NULL = Replay/chart use the recorded TSV Heat set (unchanged).
-- Non-null = edited plan [{t, bt, heater, trigger?}], same shape as roast_profiles.heater_events.
-- Raw TSV curve, inventory ledgers and save_roast_op side effects are never touched here.

alter table public.roast_sessions
  add column if not exists heater_events jsonb;

comment on column public.roast_sessions.heater_events is
  'Edited Heat set plan [{t, bt, heater, trigger?}]. NULL = extract from session TSV.';

-- Compare-and-swap on the edited fields: a concurrent edit of events/heater_events
-- raises PT409 instead of being overwritten. Unrelated column writes do not conflict.
-- Events may only change time_sec/temp_c in place (no add/delete/reorder/other keys).
-- Profiles cut from this session get their derived summary columns in the same TX.
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
     or jsonb_array_length(p_events) <> jsonb_array_length(coalesce(v_old.events, '[]'::jsonb)) then
    raise exception 'roast_record_invalid_events' using errcode = 'PT422';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_events) with ordinality as n(e, i)
    join jsonb_array_elements(v_old.events) with ordinality as o(e, i) on o.i = n.i
    where (n.e - 'time_sec' - 'temp_c') is distinct from (o.e - 'time_sec' - 'temp_c')
       or jsonb_typeof(n.e -> 'time_sec') is distinct from 'number'
       or (n.e ->> 'time_sec')::numeric < 0
       or (n.e ? 'temp_c' and jsonb_typeof(n.e -> 'temp_c') not in ('number', 'null'))
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

revoke execute on function public.update_roast_session_record(uuid, jsonb, jsonb, jsonb, jsonb, integer, integer, jsonb) from public, anon;
grant execute on function public.update_roast_session_record(uuid, jsonb, jsonb, jsonb, jsonb, integer, integer, jsonb) to authenticated;
