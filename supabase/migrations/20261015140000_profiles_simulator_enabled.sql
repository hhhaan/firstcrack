-- Per-user virtual roaster. Not a sold plan.
-- Clients can read their own row. They cannot turn the flag on: same freeze as plan.

alter table public.profiles
  add column simulator_enabled boolean not null default false;

comment on column public.profiles.simulator_enabled is
  'Internal virtual roaster. Default off. Authenticated clients cannot change it.';

-- Latest body is 20260724000000 (signup pins plan to trial). Keep that, and freeze this flag.
create or replace function public.protect_profiles_billing_columns()
returns trigger
language plpgsql
as $$
begin
  -- Authenticated clients have auth.uid(); service_role sessions typically have none.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan := 'trial';
    new.polar_customer_id := null;
    new.simulator_enabled := false;
    return new;
  end if;

  new.plan := old.plan;
  new.polar_customer_id := old.polar_customer_id;
  new.simulator_enabled := old.simulator_enabled;
  return new;
end;
$$;
