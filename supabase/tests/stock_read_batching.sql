-- Run against the pre-migration local database so the old RPC results are
-- captured before this test applies the migration inside its transaction:
-- psql ... -v ON_ERROR_STOP=1 -v owner=... -v member=... -v foreign=... \
--   -f supabase/tests/stock_read_batching.sql
BEGIN;

SELECT set_config('test.owner', :'owner', true);
SELECT set_config('test.member', :'member', true);
SELECT set_config('test.foreign', :'foreign', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

DO $$
DECLARE
  v_owner_id uuid := current_setting('test.owner')::uuid;
  v_member_id uuid := current_setting('test.member')::uuid;
  v_org_id uuid;
BEGIN
  INSERT INTO public.organizations(owner_id, name, seat_limit)
  VALUES (v_owner_id, 'stock batching test', 5)
  ON CONFLICT (owner_id) DO UPDATE SET seat_limit = GREATEST(organizations.seat_limit, 5)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members(org_id, user_id, role)
  VALUES (v_org_id, v_member_id, 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  INSERT INTO public.beans(id, user_id, name, low_stock_threshold_grams) VALUES
    ('73600000-0000-0000-0000-000000000001', v_owner_id, 'SO', 1000),
    ('73600000-0000-0000-0000-000000000002', v_owner_id, 'Blend A', 1000),
    ('73600000-0000-0000-0000-000000000003', v_owner_id, 'Blend B', 1000),
    ('73600000-0000-0000-0000-000000000004', v_owner_id, 'No ledger', 0);

  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type) VALUES
    (v_owner_id, '73600000-0000-0000-0000-000000000001', 10000, 'purchase'),
    (v_owner_id, '73600000-0000-0000-0000-000000000001', -1500, 'roast'),
    (v_owner_id, '73600000-0000-0000-0000-000000000002', 500, 'purchase'),
    (v_owner_id, '73600000-0000-0000-0000-000000000002', -700, 'adjustment'),
    (v_owner_id, '73600000-0000-0000-0000-000000000003', 1000, 'purchase');

  INSERT INTO public.blends(id, user_id, name)
  VALUES ('73600000-0000-0000-0000-000000000010', v_owner_id, 'fractional');
  INSERT INTO public.blend_components(blend_id, bean_id, ratio_pct) VALUES
    ('73600000-0000-0000-0000-000000000010', '73600000-0000-0000-0000-000000000002', 33.33),
    ('73600000-0000-0000-0000-000000000010', '73600000-0000-0000-0000-000000000003', 66.67);

  INSERT INTO public.roast_day_plans(id, user_id, date) VALUES
    ('73600000-0000-0000-0000-000000000020', v_owner_id, CURRENT_DATE - 2),
    ('73600000-0000-0000-0000-000000000021', v_owner_id, CURRENT_DATE + 2);

  INSERT INTO public.roast_plan_batches(
    id, plan_id, bean_name, bean_id, blend_id, batch_size_kg,
    target_roasted_kg, scheduled_date, status, exception_type
  ) VALUES
    ('73600000-0000-0000-0000-000000000030', '73600000-0000-0000-0000-000000000020', 'past',
      '73600000-0000-0000-0000-000000000001', NULL, 1.2, 3, CURRENT_DATE - 2, 'in-progress', NULL),
    ('73600000-0000-0000-0000-000000000031', '73600000-0000-0000-0000-000000000021', 'no date',
      '73600000-0000-0000-0000-000000000001', NULL, 1, 1, NULL, 'pending', NULL),
    ('73600000-0000-0000-0000-000000000032', '73600000-0000-0000-0000-000000000021', 'blend',
      NULL, '73600000-0000-0000-0000-000000000010', 1.001, 2, CURRENT_DATE + 2, 'pending', NULL),
    ('73600000-0000-0000-0000-000000000033', '73600000-0000-0000-0000-000000000021', 'done',
      '73600000-0000-0000-0000-000000000001', NULL, 9, 9, CURRENT_DATE, 'done', NULL),
    ('73600000-0000-0000-0000-000000000034', '73600000-0000-0000-0000-000000000021', 'skipped',
      '73600000-0000-0000-0000-000000000001', NULL, 9, 9, CURRENT_DATE, 'skipped', NULL),
    ('73600000-0000-0000-0000-000000000035', '73600000-0000-0000-0000-000000000021', 'cancelled',
      '73600000-0000-0000-0000-000000000001', NULL, 9, 9, CURRENT_DATE, 'pending', 'cancelled'),
    ('73600000-0000-0000-0000-000000000036', '73600000-0000-0000-0000-000000000021', 'outside',
      '73600000-0000-0000-0000-000000000001', NULL, 9, 9, CURRENT_DATE + 29, 'pending', NULL);

  -- Every linked session counts, irrespective of roast status.
  INSERT INTO public.roast_sessions(id, user_id, plan_batch_id, weight_grams, status) VALUES
    ('73600000-0000-0000-0000-000000000040', v_owner_id, '73600000-0000-0000-0000-000000000030', 1200, 'completed'),
    ('73600000-0000-0000-0000-000000000041', v_owner_id, '73600000-0000-0000-0000-000000000030', 1200, 'in_progress'),
    ('73600000-0000-0000-0000-000000000042', v_owner_id, '73600000-0000-0000-0000-000000000032', 1001, 'cancelled');

  INSERT INTO public.roast_profiles(id, user_id, name, source_session_id, target_level) VALUES
    ('73600000-0000-0000-0000-000000000070', v_owner_id, 'profile one',
      '73600000-0000-0000-0000-000000000040', 'Light'),
    ('73600000-0000-0000-0000-000000000071', v_owner_id, 'profile two',
      '73600000-0000-0000-0000-000000000041', 'Medium');

  INSERT INTO public.products(
    id, user_id, name, bean_id, roast_profile_id, net_weight_grams, yield_pct
  ) VALUES
    ('73600000-0000-0000-0000-000000000072', v_owner_id, 'same bean p1',
      '73600000-0000-0000-0000-000000000001', '73600000-0000-0000-0000-000000000070', 200, 0.8),
    ('73600000-0000-0000-0000-000000000073', v_owner_id, 'same bean p2',
      '73600000-0000-0000-0000-000000000001', '73600000-0000-0000-0000-000000000071', 500, 0.75);
  INSERT INTO public.product_stock_events(user_id, product_id, delta_units, event_type)
  VALUES (v_owner_id, '73600000-0000-0000-0000-000000000072', 1, 'adjustment');
  INSERT INTO public.orders(
    id, user_id, platform, platform_order_id, status, ordered_at
  ) VALUES (
    '73600000-0000-0000-0000-000000000074', v_owner_id,
    'manual', 'stock-batching-test', 'paid', now()
  );
  INSERT INTO public.order_lines(
    id, user_id, order_id, platform_line_id, product_id, title, quantity
  ) VALUES
    ('73600000-0000-0000-0000-000000000075', v_owner_id,
      '73600000-0000-0000-0000-000000000074', 'p1',
      '73600000-0000-0000-0000-000000000072', 'same bean p1', 3),
    ('73600000-0000-0000-0000-000000000076', v_owner_id,
      '73600000-0000-0000-0000-000000000074', 'p2',
      '73600000-0000-0000-0000-000000000073', 'same bean p2', 2);

  INSERT INTO public.recurrence_rules(
    id, user_id, rrule, dtstart, "until", bean_name, bean_id, blend_id,
    batch_size_kg, target_roasted_kg, yield_pct, status
  ) VALUES
    ('73600000-0000-0000-0000-000000000050', v_owner_id, 'FREQ=DAILY', CURRENT_DATE, CURRENT_DATE + 2,
      'daily', '73600000-0000-0000-0000-000000000001', NULL, 0.5, 0.4, 0.8, 'active'),
    ('73600000-0000-0000-0000-000000000051', v_owner_id, 'FREQ=WEEKLY', CURRENT_DATE, CURRENT_DATE + 28,
      'weekly', '73600000-0000-0000-0000-000000000001', NULL, 0.6, 0.5, 0.8, 'active'),
    ('73600000-0000-0000-0000-000000000052', v_owner_id, 'FREQ=WEEKLY;INTERVAL=2', CURRENT_DATE, CURRENT_DATE + 28,
      'biweekly', NULL, '73600000-0000-0000-0000-000000000010', 0.777, 0.6, 0.8, 'active'),
    ('73600000-0000-0000-0000-000000000053', v_owner_id, 'FREQ=MONTHLY', CURRENT_DATE, CURRENT_DATE + 28,
      'monthly', '73600000-0000-0000-0000-000000000003', NULL, 0.8, 0.6, 0.8, 'active'),
    ('73600000-0000-0000-0000-000000000054', v_owner_id, 'FREQ=DAILY', CURRENT_DATE, NULL,
      'cancelled rule', '73600000-0000-0000-0000-000000000001', NULL, 9, 9, 1, 'cancelled');

  -- Any materialized occurrence excludes its virtual counterpart; the row itself
  -- contributes according to its own status/exception semantics.
  INSERT INTO public.roast_plan_batches(
    id, plan_id, recurrence_rule_id, original_date, scheduled_date, exception_type,
    bean_name, bean_id, batch_size_kg, target_roasted_kg, status
  ) VALUES
    ('73600000-0000-0000-0000-000000000060', '73600000-0000-0000-0000-000000000021',
      '73600000-0000-0000-0000-000000000050', CURRENT_DATE + 1, CURRENT_DATE + 1, 'modified',
      'modified', '73600000-0000-0000-0000-000000000001', 0.9, 0.7, 'pending'),
    ('73600000-0000-0000-0000-000000000061', '73600000-0000-0000-0000-000000000021',
      '73600000-0000-0000-0000-000000000050', CURRENT_DATE + 2, CURRENT_DATE + 2, 'cancelled',
      'cancelled', '73600000-0000-0000-0000-000000000001', 9, 9, 'pending');
END;
$$;

CREATE TEMP TABLE baseline_service_auth(error text);
GRANT INSERT, SELECT ON baseline_service_auth TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.get_user_stock_summaries(
      current_setting('test.owner')::uuid, 28
    );
    INSERT INTO baseline_service_auth VALUES ('accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO baseline_service_auth VALUES (SQLSTATE || ':' || SQLERRM);
  END;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('test.owner'), true);

CREATE TEMP TABLE baseline_summary AS
SELECT b.id AS bean_id,
       public.get_bean_reserved_stock(b.id, 28) AS reserved,
       public.get_bean_effective_stock(b.id, 28) AS effective,
       public.get_bean_stock_summary(b.id, 28) AS summary
FROM public.beans b
WHERE b.user_id = current_setting('test.owner')::uuid;

CREATE TEMP TABLE baseline_all AS
SELECT public.get_user_stock_summaries(current_setting('test.owner')::uuid, 28) AS value;

CREATE TEMP TABLE baseline_requirements AS
SELECT public.get_roasting_requirements(current_setting('test.owner')::uuid) AS value;

SELECT public.compute_inventory_alerts(current_setting('test.owner')::uuid, 28);
CREATE TEMP TABLE baseline_alerts AS
SELECT bean_id, reason, current_grams, available_grams, reserved_grams,
       effective_grams, horizon_days
FROM public.inventory_alerts
WHERE user_id = current_setting('test.owner')::uuid;

CREATE TEMP TABLE baseline_acl AS
SELECT p.proname, p.proacl::text AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_bean_stock_summary', 'get_user_stock_summaries',
    'compute_inventory_alerts_for_all_users'
  );

GRANT SELECT ON baseline_summary, baseline_all, baseline_requirements,
  baseline_alerts, baseline_acl TO authenticated;

\ir ../migrations/20261010054322_stock_read_batching.sql

CREATE TEMP TABLE new_service_auth(error text);
GRANT INSERT, SELECT ON new_service_auth TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.get_user_stock_summaries(
      current_setting('test.owner')::uuid, 28
    );
    INSERT INTO new_service_auth VALUES ('accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO new_service_auth VALUES (SQLSTATE || ':' || SQLERRM);
  END;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
DO $$
BEGIN
  ASSERT (SELECT error FROM baseline_service_auth) =
         (SELECT error FROM new_service_auth),
    'service role/no-auth get_user authorization changed';
END;
$$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  member_id uuid := current_setting('test.member')::uuid;
  foreign_id uuid := current_setting('test.foreign')::uuid;
  missing_id uuid := '73600000-0000-0000-0000-000000000099';
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM baseline_summary b
    WHERE b.reserved <> public.get_bean_reserved_stock(b.bean_id, 28)
       OR b.effective <> public.get_bean_effective_stock(b.bean_id, 28)
       OR b.summary <> public.get_bean_stock_summary(b.bean_id, 28)
  ), 'single-bean RPC contract differs from baseline';
  ASSERT (SELECT value FROM baseline_all) = public.get_user_stock_summaries(owner_id, 28),
    'all-bean RPC contract differs from baseline';
  ASSERT (SELECT value FROM baseline_requirements) = public.get_roasting_requirements(owner_id),
    'requirements contract differs from baseline';
  ASSERT NOT EXISTS (
    SELECT 1
    FROM baseline_acl b
    JOIN pg_proc p ON p.proname = b.proname
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE p.proacl::text IS DISTINCT FROM b.acl
  ), 'legacy/cron execute permissions changed';
  ASSERT public.get_bean_stock_summary(missing_id, 28) =
    '{"current_grams":0,"available_grams":0,"reserved_grams":0,"effective_grams":0}'::jsonb,
    'missing single bean must retain zero summary';
  ASSERT public.get_bean_reserved_stock(NULL, 28) = 0
     AND public.get_bean_effective_stock(NULL, 28) = 0
     AND public.get_bean_stock_summary(NULL, 28) =
       '{"current_grams":0,"available_grams":0,"reserved_grams":0,"effective_grams":0}'::jsonb,
    'NULL single bean must retain zero contract';

  PERFORM set_config('request.jwt.claim.sub', member_id::text, true);
  ASSERT public.get_user_stock_summaries(owner_id, 28) = (SELECT value FROM baseline_all),
    'workspace member result differs';

  PERFORM set_config('request.jwt.claim.sub', foreign_id::text, true);
  ASSERT public.get_bean_stock_summary('73600000-0000-0000-0000-000000000001') =
    jsonb_build_object('current_grams', 0, 'available_grams', 0, 'reserved_grams', 0, 'effective_grams', 0),
    'invisible single bean must retain zero summary';
  BEGIN
    PERFORM public.get_user_stock_summaries(owner_id, 28);
    RAISE EXCEPTION 'test: foreign workspace accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'access_denied' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.compute_inventory_alerts(owner_id, 28);
  ASSERT NOT EXISTS (
    (SELECT bean_id, reason, current_grams, available_grams, reserved_grams,
            effective_grams, horizon_days
     FROM baseline_alerts
     EXCEPT
     SELECT bean_id, reason, current_grams, available_grams, reserved_grams,
            effective_grams, horizon_days
     FROM public.inventory_alerts WHERE user_id = owner_id)
    UNION ALL
    (SELECT bean_id, reason, current_grams, available_grams, reserved_grams,
            effective_grams, horizon_days
     FROM public.inventory_alerts WHERE user_id = owner_id
     EXCEPT
     SELECT bean_id, reason, current_grams, available_grams, reserved_grams,
            effective_grams, horizon_days
     FROM baseline_alerts)
  ), 'alert values or simultaneous reasons differ from baseline';
  ASSERT EXISTS (
    SELECT 1 FROM public.inventory_alerts
    WHERE user_id = owner_id
      AND bean_id = '73600000-0000-0000-0000-000000000002'
      AND reason = 'out'
      AND dismissed_at IS NULL
  ), 'out alert missing';
  ASSERT EXISTS (
    SELECT 1 FROM public.inventory_alerts
    WHERE user_id = owner_id
      AND bean_id = '73600000-0000-0000-0000-000000000002'
      AND reason = 'schedule'
  ), 'simultaneous schedule alert missing';
  ASSERT (
    SELECT COUNT(DISTINCT computed_at) = 1
    FROM public.inventory_alerts
    WHERE user_id = owner_id
  ), 'alert snapshot did not use one computed_at';

  UPDATE public.inventory_alerts
  SET dismissed_at = now()
  WHERE user_id = owner_id;
  PERFORM public.compute_inventory_alerts(owner_id, 28);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.inventory_alerts
    WHERE user_id = owner_id AND dismissed_at IS NOT NULL
  ), 'recalculation did not clear dismissed_at';

  INSERT INTO public.bean_stock_events(user_id, bean_id, delta_grams, event_type)
  VALUES (owner_id, '73600000-0000-0000-0000-000000000002', 100000, 'adjustment');
  PERFORM public.compute_inventory_alerts(owner_id, 28);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.inventory_alerts
    WHERE user_id = owner_id
      AND bean_id = '73600000-0000-0000-0000-000000000002'
  ), 'resolved out/schedule reasons were not deleted';
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_stock_summary_rows(
      current_setting('test.owner')::uuid, 28, NULL
    );
    RAISE EXCEPTION 'test: anon helper execution accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- Plans are recorded for 10/100/1000-bean target sets without a pass/fail ms threshold.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM public.get_stock_summary_rows(current_setting('test.owner')::uuid, 28, NULL);

ROLLBACK;
