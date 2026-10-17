-- invoke_order_sync_cron fixture (local PG17 after full migrations).
-- psql -v ON_ERROR_STOP=1 -v owner=11111111-1111-1111-1111-111111111111 -f supabase/tests/order_sync_scheduler.sql

CREATE TABLE IF NOT EXISTS public._order_sync_scheduler_http_log (
  id          bigserial PRIMARY KEY,
  url         text NOT NULL,
  headers     jsonb NOT NULL,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DROP FUNCTION IF EXISTS net.http_post(text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000
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
  order_sync_url constant text :=
    'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/order-sync';
  v_err text;
  v_tick record;
  v_i int;
  conn_ids uuid[] := ARRAY[]::uuid[];
  v_conn uuid;
  v_running uuid;
  v_order uuid[];
  v_elem jsonb;
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
  ASSERT (SELECT url FROM public._order_sync_scheduler_http_log ORDER BY id DESC LIMIT 1) = order_sync_url,
    'order-sync URL uses project ref vjdgdolfxvnxushxrmff';
  DELETE FROM public.sales_channel_connections WHERE shop_identifier LIKE 'sched-%';

  -- Zero due → no_due_connections tick, no HTTP
  PERFORM public.invoke_order_sync_cron();
  SELECT * INTO v_tick FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1;
  ASSERT v_tick.status = 'no_due_connections', 'zero connections → no_due';
  ASSERT v_tick.dispatched_count = 0, 'zero dispatch';
  ASSERT position(sentinel IN v_tick::text) = 0, 'tick must not store secret';

  -- Twelve due: ten dispatched, full order (null first, then oldest last_polled_at)
  conn_ids := ARRAY[]::uuid[];
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
  ASSERT v_tick.oldest_last_polled_at IS NULL, 'never-polled due → NULL oldest_last_polled_at';
  ASSERT (SELECT count(*) FROM public._order_sync_scheduler_http_log) = 10, 'ten http posts';

  SELECT array_agg((body->>'connectionId')::uuid ORDER BY id) INTO v_order
  FROM public._order_sync_scheduler_http_log;
  ASSERT v_order = (
    SELECT array_agg(s.id)
    FROM (
      SELECT c.id
      FROM public.sales_channel_connections c
      WHERE c.id = ANY (conn_ids)
      ORDER BY c.last_polled_at ASC NULLS FIRST, c.id
      LIMIT 10
    ) s
  ), 'dispatch order: nulls first then oldest last_polled_at';

  ASSERT (SELECT url FROM public._order_sync_scheduler_http_log ORDER BY id LIMIT 1) = order_sync_url,
    'dispatch URL';

  FOR v_elem IN SELECT jsonb_array_elements(v_tick.dispatches) LOOP
    ASSERT (SELECT count(*) FROM jsonb_object_keys(v_elem) k) = 2, 'dispatches entry has two keys';
    ASSERT v_elem ? 'connection_id' AND v_elem ? 'net_request_id', 'dispatches keys only';
    ASSERT NOT (v_elem ? 'url'), 'dispatches must not echo url';
  END LOOP;

  ASSERT position(sentinel IN (SELECT headers::text FROM public._order_sync_scheduler_http_log LIMIT 1)) > 0,
    'cron header carries secret to edge only';
  ASSERT position(sentinel IN v_tick.dispatches::text) = 0, 'dispatches json must not echo secret';

  -- Stale (11m) running cron row does not block dispatch
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  DELETE FROM public.order_sync_runs;
  UPDATE public.sales_channel_connections SET last_polled_at = now() - interval '20 minutes';

  v_running := conn_ids[4];
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (v_running, owner_id, 'cron', 'running', now() - interval '11 minutes');

  PERFORM public.invoke_order_sync_cron();
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = v_running
  ) = 1, 'stale 11m running row still dispatched';

  -- Fresh cron/products lock: skip dispatch, count skipped_locked
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  DELETE FROM public.order_sync_runs;
  UPDATE public.sales_channel_connections SET last_polled_at = now() - interval '20 minutes';

  v_running := conn_ids[2];
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (v_running, owner_id, 'cron', 'running', now());

  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (conn_ids[5], owner_id, 'products', 'running', now());

  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status, started_at)
  VALUES (conn_ids[3], owner_id, 'webhook', 'running', now());

  PERFORM public.invoke_order_sync_cron();
  SELECT * INTO v_tick FROM public.order_sync_scheduler_ticks ORDER BY created_at DESC LIMIT 1;
  ASSERT v_tick.skipped_locked_count = 2, 'fresh cron + products locks counted';
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = v_running
  ) = 0, 'fresh cron running not dispatched';
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = conn_ids[5]
  ) = 0, 'fresh products running not dispatched';
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = conn_ids[3]
  ) = 1, 'webhook-only running still dispatched';

  -- Non-active never dispatched
  v_conn := gen_random_uuid();
  INSERT INTO public.sales_channel_connections (
    id, user_id, platform, shop_identifier, status, last_polled_at
  ) VALUES (v_conn, owner_id, 'shopify', 'sched-disabled', 'disabled', now() - interval '1 day');
  DELETE FROM public.order_sync_scheduler_ticks;
  DELETE FROM public._order_sync_scheduler_http_log;
  DELETE FROM public.order_sync_runs;
  PERFORM public.invoke_order_sync_cron();
  ASSERT (
    SELECT count(*) FROM public._order_sync_scheduler_http_log h
    WHERE (h.body->>'connectionId')::uuid = v_conn
  ) = 0, 'disabled connection not dispatched';

  -- products trigger legal; running products blocks cron insert (23505)
  UPDATE public.order_sync_runs SET status = 'error', finished_at = now();
  INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status)
  VALUES (v_running, owner_id, 'products', 'running');
  BEGIN
    INSERT INTO public.order_sync_runs (connection_id, user_id, trigger, status)
    VALUES (v_running, owner_id, 'cron', 'running');
    RAISE EXCEPTION 'expected unique violation';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

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
