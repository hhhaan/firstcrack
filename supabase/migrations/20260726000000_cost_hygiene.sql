-- DB cost hygiene (non-destructive):
-- (a) drop duplicate permissive policies
-- (b) wrap auth.uid() as (select auth.uid()) for initplan
-- (c) restore notify_signup_slack (narrow payload + exception guard)
-- (d) hot-table FK indexes + log retention on daily cron
-- Schema types unchanged → SKIP_TYPES_GEN=1 on commit.

-- ═══════════════════════════════════════════════════════════════════════════
-- (a) Duplicate permissive policies (live pg_policies 2026-07-19)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "Users can manage their own beans" on public.beans;
drop policy if exists "Users can manage their own roast profiles" on public.roast_profiles;
drop policy if exists "Users can manage their own roast sessions" on public.roast_sessions;
-- profiles: Korean policies duplicate English (both id = auth.uid())
drop policy if exists "본인 프로필 조회" on public.profiles;
drop policy if exists "본인 프로필 수정" on public.profiles;
-- subscriptions: keep English SELECT only
drop policy if exists "본인 구독 조회" on public.subscriptions;

-- ═══════════════════════════════════════════════════════════════════════════
-- (b) auth.uid() → (select auth.uid()) initplan wrap
-- Remaining policies that still call auth.uid() directly (live 2026-07-19).
-- ═══════════════════════════════════════════════════════════════════════════

-- profiles (4 own + org collab)
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select using (id = (select auth.uid()));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile" on public.profiles
  for delete using (id = (select auth.uid()));

drop policy if exists "org collaborators can view co-member profiles" on public.profiles;
create policy "org collaborators can view co-member profiles"
  on public.profiles
  for select
  using (
    exists (
      select 1
      from public.organization_members me
      join public.organization_members them on them.org_id = me.org_id
      where me.user_id = (select auth.uid())
        and them.user_id = profiles.id
    )
  );

-- subscriptions
drop policy if exists "Users can view own subscriptions" on public.subscriptions;
create policy "Users can view own subscriptions" on public.subscriptions
  for select using (user_id = (select auth.uid()));

-- plan tables: drop legacy policies WITHOUT recreating —
-- 20260722000000_plan_tables_rls.sql (applied earlier in the same push) already
-- provides the workspace-scoped replacements ("workspace access day plans"/
-- "workspace access plan batches"). Recreating the legacy ones here would
-- reintroduce duplicate permissive policies.
drop policy if exists "users can manage own day plans" on public.roast_day_plans;
drop policy if exists "users can manage own plan batches" on public.roast_plan_batches;

-- machine_connection_logs
drop policy if exists "Users can view their own connection logs" on public.machine_connection_logs;
create policy "Users can view their own connection logs" on public.machine_connection_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their own connection logs" on public.machine_connection_logs;
create policy "Users can insert their own connection logs" on public.machine_connection_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- organization_members
drop policy if exists "org_members select self or owner" on public.organization_members;
create policy "org_members select self or owner" on public.organization_members
  for select using (
    user_id = (select auth.uid()) or public.is_org_owner(org_id)
  );

drop policy if exists "org_members delete owner or self" on public.organization_members;
create policy "org_members delete owner or self" on public.organization_members
  for delete using (
    user_id = (select auth.uid()) or public.is_org_owner(org_id)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- (c) notify_signup_slack — restore narrow payload + exception guard
-- Source of truth: 20260711000000_notify_signup_slack.sql
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.notify_signup_slack()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    -- Only the fields notify-signup needs — never full auth.users (encrypted_password, tokens, …).
    perform net.http_post(
      url := 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', jsonb_build_object(
          'id', NEW.id,
          'email', NEW.email,
          'created_at', NEW.created_at,
          'raw_user_meta_data', NEW.raw_user_meta_data
        )
      )
    );
  exception when others then
    -- Never block signups if Slack enqueue fails.
    raise warning 'notify_signup_slack failed: %', SQLERRM;
  end;

  return NEW;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- (d) Hot-table indexes + log retention on daily cron
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists roast_sessions_user_status_idx
  on public.roast_sessions (user_id, status);

create index if not exists roast_sessions_plan_batch_idx
  on public.roast_sessions (plan_batch_id)
  where plan_batch_id is not null;

create index if not exists bean_stock_events_bean_idx
  on public.bean_stock_events (bean_id);

create index if not exists roast_plan_batches_plan_idx
  on public.roast_plan_batches (plan_id);

-- Single entrypoint for cron (multi-statement schedule bodies are unreliable)
create or replace function public.run_daily_inventory_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.compute_inventory_alerts_for_all_users(28);
  delete from public.inventory_alert_runs where started_at < now() - interval '90 days';
  delete from public.order_sync_runs where started_at < now() - interval '90 days';
  delete from public.machine_connection_logs where created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.run_daily_inventory_maintenance() from public;

-- Extend daily-inventory-alerts: recompute + retention deletes
-- ts cols: inventory_alert_runs.started_at, order_sync_runs.started_at, machine_connection_logs.created_at
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'daily-inventory-alerts';

    perform cron.schedule(
      'daily-inventory-alerts',
      '0 6 * * *',
      'select public.run_daily_inventory_maintenance()'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron schedule skipped: %', SQLERRM;
end;
$cron$;
