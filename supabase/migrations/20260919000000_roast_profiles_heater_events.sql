-- #435 Replay heat-step override on a session-derived profile.
-- NULL = extract from source session TSV (unchanged). Non-null replaces the Replay plan.

alter table public.roast_profiles
  add column if not exists heater_events jsonb;

comment on column public.roast_profiles.heater_events is
  'Optional Replay plan [{t, bt, heater, trigger?}]. NULL = extract from source session TSV.';
