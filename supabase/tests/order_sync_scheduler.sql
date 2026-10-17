-- invoke_order_sync_cron fixture (local PG17 after full migrations).
-- psql -v ON_ERROR_STOP=1 -v owner=11111111-1111-1111-1111-111111111111 -f supabase/tests/order_sync_scheduler.sql

CREATE TABLE IF NOT EXISTS public._order_sync_scheduler_http_log (
  id          bigserial PRIMARY KEY,
  url         text NOT NULL,
  headers     jsonb NOT NULL,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT '{}'::jsonb,
  body jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public._order_sync_scheduler_http_log (url, headers, body)
  VALUES (url, headers, body)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  owner_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  sentinel text := 'sentinel-secret-value-not-in-tick';
  v_err text;
  v_tick record;
  v_i int;
  conn_ids uuid[] := ARRAY[]::uuid[];
  v_conn uuid;
  v_running uuid;
BEGIN
  DELETE FROM public._order_sync_scheduler_http_log;
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public.order_sync_runs;
  DELETE FROM public.sales_channel_connections;

  -- Missing / blank secret → P0001, no tick, no HTTP
  DELETE FROM vault.decrypted_secrets WHERE name = 'order_sync_cron_secret';
  BEGIN
    PERFORM public.invoke_order_sync_cron();
    RAISE EXCEPTION 'expected missing-secret raise';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    ASSERT v_err = 'order_sync_cron_secret is not configured', 'fixed missing-secret message';
    ASSERT position(sentinel IN v_err) = 0, 'secret must not appear in exception';
  END;
  ASSERT (SELECT count(*) FROM public.order_sync_scheduler_ticks) = 0, 'no tick on missing secret';
  ASSERT (SELECT count(*) FROM public._order_sync_scheduler_http_log) = 0, 'no http on missing secret';

  INSERT INTO vault.decrypted_secrets (name, decrypted_secret)
  VALUES ('order_sync_cron_secret', '   ')
  ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  BEGIN
    PERFORM public.invoke_order_sync_cron();
    RAISE EXCEPTION 'expected blank-secret raise';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    ASSERT v_err = 'order_sync_cron_secret is not configured', 'blank secret treated as missing';
  END;

  UPDATE vault.decrypted_secrets SET decrypted_secret = sentinel WHERE name = 'order_sync_cron_secret';

  -- M=15m: 10 minutes ago is not due; 16 minutes ago is due
  v_conn := gen_random_uuid();
  INSERT INTO public.sales_channel_connections (
    id, user_id, platform, shop_identifier, status, last_polled_at
  ) VALUES (v_conn, owner_id, 'shopify', 'sched-recent', 'active', now() - interval '10 minutes');
  v_conn := gen_random_uuid();
  INSERT INTO public.sales_channel_connections (
    id, user_id, platform, shop_identifier, status, last_polled_at
  ) VALUES (v_conn, owner_id, 'shopify', 'sched-due', 'active', now() - interval '16 minutes');
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  PERFORM public.invoke_order_sync_cron();
  ASSERT (SELECT count(*) FROM public._order_sync_scheduler_http_log) = 1, 'only 16m connection dispatched';
  ASSERT (
    SELECT (body->>'connectionId')::uuid FROM public._order_sync_scheduler_http_log ORDER BY id DESC LIMIT 1
  ) = v_conn, 'due connection id';
  DELETE FROM public.sales_channel_connections WHERE shop_identifier LIKE 'sched-%';

  -- Zero due → no_due_connections tick, no HTTP
  PERFORM public.invoke_order_sync_cron();
  SELECT * INTO v_tick FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1;
  ASSERT v_tick.status = 'no_due_connections', 'zero connections → no_due';
  ASSERT v_tick.dispatched_count = 0, 'zero dispatch';
  ASSERT position(sentinel IN v_tick::text) = 0, 'tick must not store secret';

  -- Twelve due: ten dispatched, oldest first (nulls first)
  FOR v_i IN 1..12 LOOP
    v_conn := gen_random_uuid();
    conn_ids := array_append(conn_ids, v_conn);
    INSERT INTO public.sales_channel_connections (
      id, user_id, platform, shop_identifier, status, last_polled_at
    ) VALUES (
      v_conn, owner_id, 'shopify', 'sched-' || v_i, 'active',
      now() - make_interval(mins => 20 + v_i)
    );
  END LOOP;
  UPDATE public.sales_channel_connections
  SET last_polled_at = NULL
  WHERE id = conn_ids[1];

  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  PERFORM public.invoke_order_sync_cron();

  SELECT * INTO v_tick FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1;
  ASSERT v_tick.due_count = 12, 'due count';
  ASSERT v_tick.dispatched_count = 10, 'cap K=10';
  ASSERT (SELECT count(*) FROM public._order_sync_scheduler_http_log) = 10, 'ten http posts';
  ASSERT (
    SELECT (body->>'connectionId')::uuid
    FROM public._order_sync_scheduler_http_log
    ORDER BY id
    LIMIT 1
  ) = conn_ids[1], 'null last_polled_at first';
  ASSERT position(sentinel IN (SELECT headers::text FROM public._order_sync_scheduler_http_log LIMIT 1)) > 0,
    'cron header carries secret to edge only';
  ASSERT position(sentinel IN v_tick.dispatches::text) = 0, 'dispatches json must not echo secret';

  -- Fresh running cron row blocks dispatch; webhook running does not
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  DELETE FROM public.order_sync_runs;
  UPDATE public.sales_channel_connections SET last_polled_at = now() - interval '20 minutes';

  v_running := conn_ids[2];
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (v_running, owner_id, 'cron', 'running', now());

  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (conn_ids[3], owner_id, 'webhook', 'running', now());

  PERFORM public.invoke_order_sync_cron();
  SELECT * INTO v_tick FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1;
  ASSERT v_tick.skipped_locked_count >= 1, 'locked due counted';
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = v_running
  ) = 0, 'locked connection not dispatched';

  -- products trigger legal; running products blocks cron insert (23505)
  UPDATE public.order_sync_runs SET status = 'error', finished_at = now() WHERE connection_id = v_running;
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status)
  VALUES (v_running, owner_id, 'products', 'running');
  BEGIN
    INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status)
    VALUES (v_running, owner_id, 'cron', 'running');
    RAISE EXCEPTION 'expected unique violation';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  UPDATE public.order_sync_runs SET status = 'error', finished_at = now() WHERE connection_id = v_running AND trigger = 'products';
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status)
  VALUES (v_running, owner_id, 'cron', 'running');

  -- overdue_count: active with last_polled older than 30 minutes
  UPDATE public.sales_channel_connections
  SET last_polled_at = now() - interval '35 minutes'
  WHERE id = conn_ids[1];
  DELETE FROM public.order_sync_scheduler_ticks;
  PERFORM public.invoke_order_sync_cron();
  ASSERT (
    SELECT overdue_count FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1
  ) >= 1, 'overdue metric populated';

  -- 90-day retention
  INSERT INTO public.order_sync_scheduler_ticks (status, created_at)
  VALUES ('no_due_connections', now() - interval '91 days');
  PERFORM public.invoke_order_sync_cron();
  ASSERT (SELECT count(*) FROM public.order_sync_scheduler_ticks WHERE created_at < now() - interval '90 days') = 0,
    'retention delete';
END $$;
