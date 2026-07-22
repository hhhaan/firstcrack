


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_bean_stock_on_purchase"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.type = 'purchase' AND NEW.change_grams > 0 THEN
    UPDATE beans
    SET stock_grams = stock_grams + NEW.change_grams,
        updated_at  = now()
    WHERE id = NEW.bean_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."add_bean_stock_on_purchase"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_auth_session_ips"() RETURNS TABLE("ip" "text", "session_count" bigint, "user_count" bigint, "last_seen" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'auth', 'public'
    AS $$
  SELECT
    host(s.ip)::text AS ip,
    count(*)::bigint AS session_count,
    count(DISTINCT s.user_id)::bigint AS user_count,
    max(s.updated_at) AS last_seen
  FROM auth.sessions s
  WHERE s.ip IS NOT NULL
  GROUP BY host(s.ip);
$$;


ALTER FUNCTION "public"."admin_auth_session_ips"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_auth_session_ips"() IS 'Admin dashboard: aggregate auth.sessions by IP for geo activity map';



CREATE OR REPLACE FUNCTION "public"."admin_auth_user_activity"() RETURNS TABLE("user_id" "uuid", "last_seen" timestamp with time zone, "session_count" bigint, "last_ip" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'auth', 'public'
    AS $$
  SELECT
    s.user_id,
    max(s.updated_at) AS last_seen,
    count(*)::bigint AS session_count,
    (
      SELECT host(s2.ip)::text
      FROM auth.sessions s2
      WHERE s2.user_id = s.user_id
        AND s2.ip IS NOT NULL
      ORDER BY s2.updated_at DESC NULLS LAST
      LIMIT 1
    ) AS last_ip
  FROM auth.sessions s
  GROUP BY s.user_id
  ORDER BY last_seen DESC NULLS LAST;
$$;


ALTER FUNCTION "public"."admin_auth_user_activity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_auth_user_activity"() IS 'Admin dashboard: per-user auth.sessions rollup for activity tracking';



CREATE OR REPLACE FUNCTION "public"."admin_user_roster"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone, "provider" "text", "display_name" "text", "business_name" "text", "plan" "text", "polar_customer_id" "text", "roast_count" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'auth', 'public'
    AS $$
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    coalesce(u.raw_app_meta_data->>'provider', 'email')::text AS provider,
    p.display_name,
    p.business_name,
    coalesce(p.plan, 'unknown')::text AS plan,
    p.polar_customer_id,
    coalesce(rs.cnt, 0)::bigint AS roast_count
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN (
    SELECT user_id, count(*) AS cnt
    FROM public.roast_sessions
    GROUP BY user_id
  ) rs ON rs.user_id = u.id
  WHERE u.deleted_at IS NULL
  ORDER BY u.created_at DESC;
$$;


ALTER FUNCTION "public"."admin_user_roster"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_user_roster"() IS 'Admin dashboard: user list with plan and roast counts';



CREATE OR REPLACE FUNCTION "public"."calc_plan_batch_count"("p_target_roasted_kg" numeric, "p_batch_size_kg" numeric, "p_yield_pct" numeric, "p_batch_count" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_roasted_per_batch numeric;
BEGIN
  IF p_batch_count IS NOT NULL AND p_batch_count > 0 THEN
    RETURN p_batch_count;
  END IF;

  IF COALESCE(p_batch_size_kg, 0) <= 0 OR COALESCE(p_target_roasted_kg, 0) <= 0 THEN
    RETURN 1;
  END IF;

  v_roasted_per_batch := p_batch_size_kg * GREATEST(COALESCE(p_yield_pct, 1), 0.0001);
  RETURN CEIL(p_target_roasted_kg / v_roasted_per_batch)::integer;
END;
$$;


ALTER FUNCTION "public"."calc_plan_batch_count"("p_target_roasted_kg" numeric, "p_batch_size_kg" numeric, "p_yield_pct" numeric, "p_batch_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id)
  SELECT ol.user_id, ol.product_id, ol.quantity, 'order_cancel', ol.id
  FROM order_lines ol
  WHERE ol.order_id = p_order_id
    AND ol.product_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM product_stock_events pse
      WHERE pse.reference_id = ol.id AND pse.event_type = 'order_fulfillment'
    )
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;

  UPDATE orders SET status = 'cancelled', updated_at = now()
  WHERE id = p_order_id;
END;
$$;


ALTER FUNCTION "public"."cancel_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_blend_ratio_sum"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_blend_id uuid;
  v_total numeric;
BEGIN
  v_blend_id := COALESCE(NEW.blend_id, OLD.blend_id);

  IF NOT EXISTS (SELECT 1 FROM blends WHERE id = v_blend_id) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(ratio_pct), 0) INTO v_total
  FROM blend_components
  WHERE blend_id = v_blend_id;

  IF v_total <> 100 THEN
    RAISE EXCEPTION 'blend_components ratio_pct must sum to 100 (got %)', v_total;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."check_blend_ratio_sum"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_inventory_alerts"("p_user_id" "uuid", "p_horizon_days" integer DEFAULT 28) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bean record;
  v_current integer;
  v_available integer;
  v_reserved integer;
  v_effective integer;
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  FOR v_bean IN
    SELECT id, low_stock_threshold_grams
    FROM beans
    WHERE user_id = p_user_id
  LOOP
    v_current := get_bean_current_stock(v_bean.id);
    v_available := get_bean_available_stock(v_bean.id);
    v_reserved := get_bean_reserved_stock(v_bean.id, p_horizon_days);
    v_effective := v_available - v_reserved;

    IF v_current > 0 AND v_effective >= 0 AND v_current > v_bean.low_stock_threshold_grams THEN
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id;
      CONTINUE;
    END IF;

    IF v_current <= 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'out',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    END IF;

    IF v_effective < 0 THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'schedule',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'schedule';
    END IF;

    IF v_current > 0 AND v_current <= v_bean.low_stock_threshold_grams THEN
      INSERT INTO inventory_alerts (
        user_id, bean_id, reason,
        current_grams, available_grams, reserved_grams, effective_grams,
        horizon_days, computed_at, dismissed_at
      ) VALUES (
        p_user_id, v_bean.id, 'low',
        v_current, v_available, v_reserved, v_effective,
        p_horizon_days, now(), NULL
      )
      ON CONFLICT (user_id, bean_id, reason) DO UPDATE SET
        current_grams = EXCLUDED.current_grams,
        available_grams = EXCLUDED.available_grams,
        reserved_grams = EXCLUDED.reserved_grams,
        effective_grams = EXCLUDED.effective_grams,
        horizon_days = EXCLUDED.horizon_days,
        computed_at = EXCLUDED.computed_at,
        dismissed_at = NULL;
    ELSE
      DELETE FROM inventory_alerts
      WHERE user_id = p_user_id AND bean_id = v_bean.id AND reason = 'low';
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."compute_inventory_alerts"("p_user_id" "uuid", "p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_inventory_alerts_for_all_users"("p_horizon_days" integer DEFAULT 28) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_run_id uuid;
  v_user_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(867530901) THEN
    RAISE NOTICE 'inventory alert compute already running';
    RETURN NULL;
  END IF;

  INSERT INTO inventory_alert_runs (status)
  VALUES ('running')
  RETURNING id INTO v_run_id;

  BEGIN
    FOR v_user_id IN
      SELECT DISTINCT user_id FROM beans
    LOOP
      PERFORM compute_inventory_alerts(v_user_id, p_horizon_days);
      v_count := v_count + 1;
    END LOOP;

    UPDATE inventory_alert_runs
    SET status = 'success',
        finished_at = now(),
        users_processed = v_count
    WHERE id = v_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE inventory_alert_runs
    SET status = 'error',
        finished_at = now(),
        users_processed = v_count,
        error_message = SQLERRM
    WHERE id = v_run_id;
    RAISE;
  END;

  RETURN v_run_id;
END;
$$;


ALTER FUNCTION "public"."compute_inventory_alerts_for_all_users"("p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_org_invite"("p_token" "text", "p_expires_in" interval DEFAULT '7 days'::interval) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_seat_limit integer;
  v_member_count integer;
  v_pending_count integer;
  v_name text;
  v_plan text;
  v_invite_id uuid;
  v_default_seats integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT plan INTO v_plan FROM profiles WHERE id = v_uid;
  IF v_plan IS NULL OR v_plan NOT IN ('enterprise', 'team') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT id, seat_limit INTO v_org_id, v_seat_limit
  FROM organizations
  WHERE owner_id = v_uid
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    SELECT COALESCE(nullif(trim(business_name), ''), 'My Roastery')
    INTO v_name
    FROM profiles
    WHERE id = v_uid;

    v_default_seats := 5;

    INSERT INTO organizations (owner_id, name, seat_limit)
    VALUES (v_uid, COALESCE(v_name, 'My Roastery'), v_default_seats)
    RETURNING id, seat_limit INTO v_org_id, v_seat_limit;

    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

    SELECT id, seat_limit INTO v_org_id, v_seat_limit
    FROM organizations
    WHERE id = v_org_id
    FOR UPDATE;
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM organization_members
  WHERE org_id = v_org_id;

  SELECT count(*)::integer INTO v_pending_count
  FROM organization_invites
  WHERE org_id = v_org_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_member_count + v_pending_count + 1 > v_seat_limit THEN
    RAISE EXCEPTION 'seat_limit_reached';
  END IF;

  INSERT INTO organization_invites (org_id, token, expires_at)
  VALUES (v_org_id, p_token, now() + p_expires_in)
  RETURNING id INTO v_invite_id;

  RETURN v_invite_id;
END;
$$;


ALTER FUNCTION "public"."create_org_invite"("p_token" "text", "p_expires_in" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_bean_stock_on_roast"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- status가 completed로 변경될 때만 처리
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') AND NEW.bean_id IS NOT NULL THEN
    -- beans.stock_grams 차감
    UPDATE beans
    SET stock_grams = GREATEST(0, stock_grams - NEW.weight_grams),
        updated_at  = now()
    WHERE id = NEW.bean_id;

    -- 인벤토리 로그 기록
    INSERT INTO bean_inventory_logs (user_id, bean_id, change_grams, type, roast_session_id, note)
    VALUES (NEW.user_id, NEW.bean_id, -NEW.weight_grams, 'roast', NEW.id, '로스팅 완료 자동 차감');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."deduct_bean_stock_on_roast"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_roast_session"("p_session_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM bean_stock_events    WHERE reference_id = p_session_id AND event_type = 'roast';
  DELETE FROM roasted_stock_events WHERE reference_id = p_session_id AND event_type = 'roast_inbound';
  DELETE FROM roast_sessions       WHERE id = p_session_id;
END;
$$;


ALTER FUNCTION "public"."delete_roast_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expand_rrule_in_range"("p_rrule" "text", "p_dtstart" "date", "p_range_start" "date", "p_range_end" "date", "p_until" "date" DEFAULT NULL::"date") RETURNS SETOF "date"
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_effective_start date;
  v_effective_end date;
  v_current date;
  v_interval_weeks integer := 1;
BEGIN
  v_effective_start := GREATEST(p_dtstart, p_range_start);
  v_effective_end := LEAST(p_range_end, COALESCE(p_until, p_range_end));

  IF v_effective_start > v_effective_end THEN
    RETURN;
  END IF;

  IF p_rrule LIKE '%INTERVAL=2%' THEN
    v_interval_weeks := 2;
  END IF;

  IF p_rrule LIKE '%FREQ=DAILY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := v_current + 1;
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := v_current + 1;
    END LOOP;
    RETURN;
  END IF;

  IF p_rrule LIKE '%FREQ=WEEKLY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := v_current + (7 * v_interval_weeks);
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := v_current + (7 * v_interval_weeks);
    END LOOP;
    RETURN;
  END IF;

  IF p_rrule LIKE '%FREQ=MONTHLY%' THEN
    v_current := p_dtstart;
    WHILE v_current < v_effective_start LOOP
      v_current := (v_current + INTERVAL '1 month')::date;
    END LOOP;
    WHILE v_current <= v_effective_end LOOP
      RETURN NEXT v_current;
      v_current := (v_current + INTERVAL '1 month')::date;
    END LOOP;
    RETURN;
  END IF;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."expand_rrule_in_range"("p_rrule" "text", "p_dtstart" "date", "p_range_start" "date", "p_range_end" "date", "p_until" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fulfill_order"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, created_by)
  SELECT ol.user_id, ol.product_id, -ol.quantity, 'order_fulfillment', ol.id, auth.uid()
  FROM order_lines ol
  WHERE ol.order_id = p_order_id AND ol.status = 'active' AND ol.product_id IS NOT NULL
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;

  UPDATE orders SET fulfilled_at = now(), updated_at = now()
  WHERE id = p_order_id AND fulfilled_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."fulfill_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bean_available_stock"("p_bean_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(SUM(delta_grams), 0)::integer
  FROM bean_stock_events
  WHERE bean_id = p_bean_id;
$$;


ALTER FUNCTION "public"."get_bean_available_stock"("p_bean_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bean_current_stock"("p_bean_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(SUM(delta_grams), 0)::integer
  FROM bean_stock_events
  WHERE bean_id = p_bean_id
    AND event_type <> 'expected_inbound';
$$;


ALTER FUNCTION "public"."get_bean_current_stock"("p_bean_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bean_effective_stock"("p_bean_id" "uuid", "p_horizon_days" integer DEFAULT 28) RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT get_bean_available_stock(p_bean_id) - get_bean_reserved_stock(p_bean_id, p_horizon_days);
$$;


ALTER FUNCTION "public"."get_bean_effective_stock"("p_bean_id" "uuid", "p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bean_reserved_stock"("p_bean_id" "uuid", "p_horizon_days" integer DEFAULT 28) RETURNS integer
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_horizon date := CURRENT_DATE + p_horizon_days;
  v_reserved integer := 0;
  v_row record;
  v_rec record;
  v_remaining integer;
  v_batch_count integer;
  v_occurrence date;
  v_excluded boolean;
BEGIN
  FOR v_row IN
    SELECT
      b.id,
      b.batch_size_kg,
      b.batch_count,
      b.yield_pct,
      b.target_roasted_kg,
      COALESCE(sess.completed, 0) AS completed
    FROM roast_plan_batches b
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS completed
      FROM roast_sessions s
      WHERE s.plan_batch_id = b.id
    ) sess ON true
    WHERE b.bean_id = p_bean_id
      AND b.status IN ('pending', 'in-progress')
      AND b.exception_type IS DISTINCT FROM 'cancelled'
      AND (b.scheduled_date IS NULL OR b.scheduled_date <= v_horizon)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_row.target_roasted_kg,
      v_row.batch_size_kg,
      v_row.yield_pct,
      v_row.batch_count
    );
    v_remaining := GREATEST(0, v_batch_count - v_row.completed);
    v_reserved := v_reserved + (v_remaining * v_row.batch_size_kg * 1000)::integer;
  END LOOP;

  FOR v_row IN
    SELECT
      b.id,
      b.batch_size_kg,
      b.batch_count,
      b.yield_pct,
      b.target_roasted_kg,
      bc.ratio_pct,
      COALESCE(sess.completed, 0) AS completed
    FROM roast_plan_batches b
    JOIN blend_components bc ON bc.blend_id = b.blend_id AND bc.bean_id = p_bean_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS completed
      FROM roast_sessions s
      WHERE s.plan_batch_id = b.id
    ) sess ON true
    WHERE b.blend_id IS NOT NULL
      AND b.status IN ('pending', 'in-progress')
      AND b.exception_type IS DISTINCT FROM 'cancelled'
      AND (b.scheduled_date IS NULL OR b.scheduled_date <= v_horizon)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_row.target_roasted_kg,
      v_row.batch_size_kg,
      v_row.yield_pct,
      v_row.batch_count
    );
    v_remaining := GREATEST(0, v_batch_count - v_row.completed);
    v_reserved := v_reserved + (
      v_remaining * v_row.batch_size_kg * 1000 * v_row.ratio_pct / 100
    )::integer;
  END LOOP;

  FOR v_rec IN
    SELECT r.*
    FROM recurrence_rules r
    WHERE r.status = 'active'
      AND r.bean_id = p_bean_id
      AND (r.until IS NULL OR r.until >= v_today)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_rec.target_roasted_kg,
      v_rec.batch_size_kg,
      v_rec.yield_pct,
      NULL
    );

    FOR v_occurrence IN
      SELECT expand_rrule_in_range(
        v_rec.rrule,
        v_rec.dtstart,
        v_today,
        v_horizon,
        v_rec.until
      )
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM roast_plan_batches ex
        WHERE ex.recurrence_rule_id = v_rec.id
          AND ex.original_date = v_occurrence
      ) INTO v_excluded;

      IF NOT v_excluded THEN
        v_reserved := v_reserved + (v_batch_count * v_rec.batch_size_kg * 1000)::integer;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_rec IN
    SELECT r.*, bc.ratio_pct
    FROM recurrence_rules r
    JOIN blend_components bc ON bc.blend_id = r.blend_id AND bc.bean_id = p_bean_id
    WHERE r.status = 'active'
      AND r.blend_id IS NOT NULL
      AND (r.until IS NULL OR r.until >= v_today)
  LOOP
    v_batch_count := calc_plan_batch_count(
      v_rec.target_roasted_kg,
      v_rec.batch_size_kg,
      v_rec.yield_pct,
      NULL
    );

    FOR v_occurrence IN
      SELECT expand_rrule_in_range(
        v_rec.rrule,
        v_rec.dtstart,
        v_today,
        v_horizon,
        v_rec.until
      )
    LOOP
      SELECT EXISTS (
        SELECT 1
        FROM roast_plan_batches ex
        WHERE ex.recurrence_rule_id = v_rec.id
          AND ex.original_date = v_occurrence
      ) INTO v_excluded;

      IF NOT v_excluded THEN
        v_reserved := v_reserved + (
          v_batch_count * v_rec.batch_size_kg * 1000 * v_rec.ratio_pct / 100
        )::integer;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_reserved;
END;
$$;


ALTER FUNCTION "public"."get_bean_reserved_stock"("p_bean_id" "uuid", "p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bean_stock_summary"("p_bean_id" "uuid", "p_horizon_days" integer DEFAULT 28) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT jsonb_build_object(
    'current_grams', get_bean_current_stock(p_bean_id),
    'available_grams', get_bean_available_stock(p_bean_id),
    'reserved_grams', get_bean_reserved_stock(p_bean_id, p_horizon_days),
    'effective_grams', get_bean_effective_stock(p_bean_id, p_horizon_days)
  );
$$;


ALTER FUNCTION "public"."get_bean_stock_summary"("p_bean_id" "uuid", "p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_current_stock"("p_product_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(SUM(delta_units), 0)::integer
  FROM product_stock_events
  WHERE product_id = p_product_id;
$$;


ALTER FUNCTION "public"."get_product_current_stock"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_roasting_requirements"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    WITH demand AS (
      SELECT ol.product_id, SUM(ol.quantity)::integer AS ordered_units
      FROM order_lines ol
      JOIN orders o ON o.id = ol.order_id
      WHERE ol.user_id = p_user_id
        AND ol.status = 'active'
        AND ol.product_id IS NOT NULL
        AND o.status IN ('paid', 'preparing')
        AND o.fulfilled_at IS NULL
      GROUP BY ol.product_id
    ),
    stock AS (
      SELECT product_id, SUM(delta_units)::integer AS units
      FROM product_stock_events
      GROUP BY product_id
    ),
    shortfall AS (
      SELECT
        d.product_id,
        d.ordered_units,
        COALESCE(st.units, 0) AS on_hand_units,
        GREATEST(0, d.ordered_units - COALESCE(st.units, 0)) AS shortfall_units,
        p.name,
        p.bean_id,
        p.blend_id,
        p.roast_profile_id,
        p.net_weight_grams,
        p.yield_pct
      FROM demand d
      JOIN products p ON p.id = d.product_id
      LEFT JOIN stock st ON st.product_id = d.product_id
    ),
    bean_demand AS (
      SELECT
        COALESCE(bc.bean_id, s.bean_id) AS bean_id,
        s.roast_profile_id,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100
        ) AS roasted_grams,
        SUM(
          s.shortfall_units * s.net_weight_grams
          * COALESCE(bc.ratio_pct, 100) / 100 / s.yield_pct
        ) AS green_grams
      FROM shortfall s
      LEFT JOIN blend_components bc ON bc.blend_id = s.blend_id
      WHERE s.shortfall_units > 0
        AND (s.bean_id IS NOT NULL OR bc.bean_id IS NOT NULL)
      GROUP BY COALESCE(bc.bean_id, s.bean_id), s.roast_profile_id
    )
    SELECT jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', s.product_id,
          'name', s.name,
          'ordered_units', s.ordered_units,
          'on_hand_units', s.on_hand_units,
          'shortfall_units', s.shortfall_units
        ) ORDER BY s.name)
        FROM shortfall s
      ), '[]'::jsonb),
      'beans', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bean_id', bd.bean_id,
          'roast_profile_id', bd.roast_profile_id,
          'roasted_grams_needed', ROUND(bd.roasted_grams)::integer,
          'green_grams_needed', ROUND(bd.green_grams)::integer,
          'green_available', get_bean_available_stock(bd.bean_id)
        ))
        FROM bean_demand bd
      ), '[]'::jsonb)
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_roasting_requirements"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_product_stock"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    SELECT COALESCE(
      jsonb_object_agg(p.id::text, COALESCE(s.units, 0)),
      '{}'::jsonb
    )
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(delta_units)::integer AS units
      FROM product_stock_events
      GROUP BY product_id
    ) s ON s.product_id = p.id
    WHERE p.user_id = p_user_id
  );
END;
$$;


ALTER FUNCTION "public"."get_user_product_stock"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_roasted_stock"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    AS $$
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
    SELECT
      CASE WHEN bean_id IS NOT NULL THEN 'bean:' || bean_id ELSE 'blend:' || blend_id END AS k,
      jsonb_build_object(
        'grams', SUM(delta_grams),
        'has_estimate', bool_or(is_estimate AND event_type = 'roast_inbound')
      ) AS v
    FROM roasted_stock_events
    WHERE user_id = p_user_id
    GROUP BY 1
  ) s;
$$;


ALTER FUNCTION "public"."get_user_roasted_stock"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_stock_summaries"("p_user_id" "uuid", "p_horizon_days" integer DEFAULT 28) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN (
    SELECT COALESCE(
      jsonb_object_agg(
        b.id::text,
        get_bean_stock_summary(b.id, p_horizon_days)
      ),
      '{}'::jsonb
    )
    FROM beans b
    WHERE b.user_id = p_user_id
  );
END;
$$;


ALTER FUNCTION "public"."get_user_stock_summaries"("p_user_id" "uuid", "p_horizon_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_workspace_access"("target_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid() = target_owner
      OR EXISTS (
           SELECT 1 FROM organizations o
           JOIN organization_members m ON m.org_id = o.id
           WHERE o.owner_id = target_owner AND m.user_id = auth.uid()
         );
$$;


ALTER FUNCTION "public"."has_workspace_access"("target_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_packaging_op"("p_product_events" "jsonb", "p_roasted_events" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'product_id')::uuid,
    (e->>'delta_units')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', '')
  FROM jsonb_array_elements(p_product_events) AS e
  ON CONFLICT DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."insert_packaging_op"("p_product_events" "jsonb", "p_roasted_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_product_stock_events_batch"("p_events" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO product_stock_events (user_id, product_id, delta_units, event_type, reference_id, note, created_by)
  SELECT (e->>'user_id')::uuid, (e->>'product_id')::uuid, (e->>'delta_units')::integer, (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid, NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT (reference_id, product_id, event_type) WHERE reference_id IS NOT NULL DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."insert_product_stock_events_batch"("p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_roasted_stock_events_batch"("p_events" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, note, is_estimate)
  SELECT (e->>'user_id')::uuid, (e->>'bean_id')::uuid, (e->>'blend_id')::uuid,
         (e->>'delta_grams')::integer, e->>'event_type', (e->>'reference_id')::uuid,
         e->>'note', COALESCE((e->>'is_estimate')::boolean, false)
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."insert_roasted_stock_events_batch"("p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_stock_events_batch"("p_events" "jsonb", "p_roasted_events" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_ref uuid;
  v_has_roast boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
  ) INTO v_has_roast;

  IF v_has_roast THEN
    SELECT NULLIF(e->>'reference_id', '')::uuid INTO v_ref
    FROM jsonb_array_elements(p_events) AS e
    WHERE e->>'event_type' = 'roast'
    LIMIT 1;

    IF v_ref IS NOT NULL AND roast_deduction_blocked(v_ref) THEN
      RAISE EXCEPTION 'roast_already_deducted'
        USING ERRCODE = 'unique_violation',
              DETAIL = format('reference_id=%s', v_ref);
    END IF;
  END IF;

  INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, reference_id, note, created_by)
  SELECT
    (e->>'user_id')::uuid,
    (e->>'bean_id')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    NULLIF(e->>'note', ''),
    COALESCE(NULLIF(e->>'created_by', '')::uuid, auth.uid())
  FROM jsonb_array_elements(p_events) AS e
  ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  SELECT
    (e->>'user_id')::uuid,
    NULLIF(e->>'bean_id', '')::uuid,
    NULLIF(e->>'blend_id', '')::uuid,
    (e->>'delta_grams')::integer,
    (e->>'event_type')::text,
    NULLIF(e->>'reference_id', '')::uuid,
    COALESCE((e->>'is_estimate')::boolean, false),
    auth.uid()
  FROM jsonb_array_elements(p_roasted_events) AS e
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."insert_stock_events_batch"("p_events" "jsonb", "p_roasted_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member_or_owner"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.is_org_owner(p_org_id)
      OR EXISTS (
           SELECT 1 FROM organization_members m
           WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
         );
$$;


ALTER FUNCTION "public"."is_org_member_or_owner"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_owner"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = p_org_id AND o.owner_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_org_owner"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_org_members"("p_org_id" "uuid") RETURNS TABLE("user_id" "uuid", "role" "text", "created_at" timestamp with time zone, "display_name" "text", "business_name" "text", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT
    m.user_id,
    m.role,
    m.created_at,
    p.display_name,
    p.business_name,
    u.email::text
  FROM public.organization_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.org_id = p_org_id
    AND public.is_org_member_or_owner(p_org_id)
  ORDER BY m.created_at;
$$;


ALTER FUNCTION "public"."list_org_members"("p_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_org_members"("p_org_id" "uuid") IS 'Org member directory with display name + email. Caller must be member or owner.';



CREATE OR REPLACE FUNCTION "public"."notify_signup_slack"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vjdgdolfxvnxushxrmff.supabase.co/functions/v1/notify-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW)
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_signup_slack"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_org_invite"("p_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invite organization_invites%ROWTYPE;
  v_owner_id uuid;
  v_seat_limit integer;
  v_member_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT * INTO v_invite
  FROM organization_invites
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  SELECT owner_id, seat_limit INTO v_owner_id, v_seat_limit
  FROM organizations
  WHERE id = v_invite.org_id
  FOR UPDATE;

  IF v_owner_id = v_uid THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = v_invite.org_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  SELECT count(*)::integer INTO v_member_count
  FROM organization_members
  WHERE org_id = v_invite.org_id;

  IF v_member_count + 1 > v_seat_limit THEN
    RAISE EXCEPTION 'seat_limit_reached';
  END IF;

  BEGIN
    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_invite.org_id, v_uid, 'member');
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'already_member';
  END;

  UPDATE organization_invites
  SET accepted_by = v_uid, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.org_id;
END;
$$;


ALTER FUNCTION "public"."redeem_org_invite"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_member_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM organizations
  WHERE id = p_org_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF p_member_id = v_owner_id THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  IF v_uid <> v_owner_id AND v_uid <> p_member_id THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  DELETE FROM organization_members
  WHERE org_id = p_org_id AND user_id = p_member_id;
END;
$$;


ALTER FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_blend_components"("p_blend_id" "uuid", "p_components" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM blends b
    WHERE b.id = p_blend_id
      AND public.has_workspace_access(b.user_id)
  ) THEN
    RAISE EXCEPTION 'blend not found or access denied';
  END IF;

  DELETE FROM blend_components WHERE blend_id = p_blend_id;

  INSERT INTO blend_components (blend_id, bean_id, ratio_pct)
  SELECT
    p_blend_id,
    (c->>'bean_id')::uuid,
    (c->>'ratio_pct')::numeric
  FROM jsonb_array_elements(p_components) AS c;
END;
$$;


ALTER FUNCTION "public"."replace_blend_components"("p_blend_id" "uuid", "p_components" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_org_invite"("p_invite_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT org_id INTO v_org_id
  FROM organization_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;
  IF NOT public.is_org_owner(v_org_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  UPDATE organization_invites
  SET revoked_at = now()
  WHERE id = p_invite_id AND revoked_at IS NULL AND accepted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."revoke_org_invite"("p_invite_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roast_deduction_blocked"("p_reference_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM roast_plan_batches WHERE id = p_reference_id) THEN
    RETURN EXISTS (
      SELECT 1 FROM bean_stock_events
      WHERE reference_id = p_reference_id AND event_type = 'roast'
      LIMIT 1
    );
  END IF;

  SELECT plan_batch_id INTO v_batch_id
  FROM roast_sessions
  WHERE id = p_reference_id;

  IF v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bean_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast'
    LIMIT 1
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."roast_deduction_blocked"("p_reference_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."roast_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bean_id" "uuid",
    "profile_id" "uuid",
    "weight_grams" integer NOT NULL,
    "drop_temp_celsius" integer,
    "duration_seconds" integer,
    "roast_level" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "scheduled_at" timestamp with time zone,
    "roasted_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tsv_path" "text",
    "ambient_temp_celsius" real,
    "ambient_humidity_pct" real,
    "plan_batch_id" "uuid",
    "events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "bbp_tsv_path" "text",
    "bbp_seconds" integer,
    "charge_temp_celsius" numeric,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "output_weight_grams" integer,
    CONSTRAINT "roast_sessions_check" CHECK ((("output_weight_grams" IS NULL) OR (("output_weight_grams" > 0) AND ("output_weight_grams" <= "weight_grams")))),
    CONSTRAINT "roast_sessions_roast_level_check" CHECK (("roast_level" = ANY (ARRAY['Light'::"text", 'Medium-Light'::"text", 'Medium'::"text", 'Medium-Dark'::"text", 'Dark'::"text"]))),
    CONSTRAINT "roast_sessions_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."roast_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."roast_sessions"."weight_grams" IS '생두 투입량(g) — 재고 차감 기준';



COMMENT ON COLUMN "public"."roast_sessions"."events" IS 'Roast events [{id,type,time_sec,temp_c?,note?}] — charge-relative time_sec';



COMMENT ON COLUMN "public"."roast_sessions"."output_weight_grams" IS '실측 배출량(g) — null이면 감량률 추정 폴백';



CREATE OR REPLACE FUNCTION "public"."save_roast_op"("p_session" "jsonb", "p_deduct" boolean, "p_deduction_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) RETURNS "public"."roast_sessions"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_session roast_sessions;
  v_blend_id uuid;
  v_bean_id uuid;
  v_user_id uuid;
  v_blend_name text;
  v_allocated integer := 0;
  v_grams integer;
  v_comp record;
  v_count integer;
  v_i integer := 0;
BEGIN
  v_user_id := (p_session->>'user_id')::uuid;
  IF v_user_id IS NULL OR NOT public.has_workspace_access(v_user_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;

  INSERT INTO roast_sessions (
    user_id, weight_grams, output_weight_grams, status, roasted_at, duration_seconds,
    drop_temp_celsius, roast_level, scheduled_at, notes,
    ambient_temp_celsius, ambient_humidity_pct, bean_id, profile_id,
    tsv_path, bbp_tsv_path, bbp_seconds, charge_temp_celsius, plan_batch_id, events,
    created_by
  ) VALUES (
    v_user_id,
    (p_session->>'weight_grams')::integer,
    NULLIF(p_session->>'output_weight_grams', '')::integer,
    COALESCE(p_session->>'status', 'completed'),
    NULLIF(p_session->>'roasted_at', '')::timestamptz,
    NULLIF(p_session->>'duration_seconds', '')::integer,
    NULLIF(p_session->>'drop_temp_celsius', '')::integer,
    NULLIF(p_session->>'roast_level', ''),
    NULLIF(p_session->>'scheduled_at', '')::timestamptz,
    NULLIF(p_session->>'notes', ''),
    NULLIF(p_session->>'ambient_temp_celsius', '')::numeric,
    NULLIF(p_session->>'ambient_humidity_pct', '')::numeric,
    NULLIF(p_session->>'bean_id', '')::uuid,
    NULLIF(p_session->>'profile_id', '')::uuid,
    NULLIF(p_session->>'tsv_path', ''),
    NULLIF(p_session->>'bbp_tsv_path', ''),
    NULLIF(p_session->>'bbp_seconds', '')::integer,
    NULLIF(p_session->>'charge_temp_celsius', '')::integer,
    NULLIF(p_session->>'plan_batch_id', '')::uuid,
    COALESCE(p_session->'events', '[]'::jsonb),
    auth.uid()
  )
  RETURNING * INTO v_session;

  IF COALESCE(p_deduct, false)
     AND COALESCE(p_deduction_grams, 0) > 0
     AND NOT roast_deduction_blocked(v_session.id)
  THEN
    v_bean_id := v_session.bean_id;
    v_blend_id := NULL;

    IF v_session.plan_batch_id IS NOT NULL THEN
      SELECT blend_id INTO v_blend_id
      FROM roast_plan_batches
      WHERE id = v_session.plan_batch_id;
    END IF;

    IF v_blend_id IS NOT NULL THEN
      SELECT count(*)::int INTO v_count
      FROM blend_components
      WHERE blend_id = v_blend_id;

      IF v_count = 0 THEN
        RAISE EXCEPTION 'blend has no components';
      END IF;

      SELECT name INTO v_blend_name FROM blends WHERE id = v_blend_id;

      FOR v_comp IN
        SELECT bean_id, ratio_pct
        FROM blend_components
        WHERE blend_id = v_blend_id
        ORDER BY bean_id
      LOOP
        v_i := v_i + 1;
        IF v_i = v_count THEN
          v_grams := p_deduction_grams - v_allocated;
        ELSE
          v_grams := round(p_deduction_grams * (v_comp.ratio_pct / 100.0))::integer;
        END IF;
        v_allocated := v_allocated + v_grams;

        IF v_grams > 0 THEN
          INSERT INTO bean_stock_events (
            user_id, bean_id, delta_grams, event_type, reference_id, note, created_by
          ) VALUES (
            v_user_id, v_comp.bean_id, -v_grams, 'roast', v_session.id,
            COALESCE(v_blend_name, 'blend') || ' 블렌드 차감',
            auth.uid()
          )
          ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
        END IF;
      END LOOP;
    ELSIF v_bean_id IS NOT NULL THEN
      INSERT INTO bean_stock_events (
        user_id, bean_id, delta_grams, event_type, reference_id, created_by
      ) VALUES (
        v_user_id, v_bean_id, -p_deduction_grams, 'roast', v_session.id, auth.uid()
      )
      ON CONFLICT (reference_id, bean_id) WHERE reference_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(v_session.id, v_user_id, p_inbound_grams,
                                   COALESCE(p_inbound_is_estimate, false));
  END IF;

  RETURN v_session;
END;
$$;


ALTER FUNCTION "public"."save_roast_op"("p_session" "jsonb", "p_deduct" boolean, "p_deduction_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_session_output_weight"("p_session_id" "uuid", "p_output_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE roast_sessions
  SET output_weight_grams = p_output_grams
  WHERE id = p_session_id
  RETURNING user_id INTO v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or access denied';
  END IF;

  IF COALESCE(p_inbound_grams, 0) > 0 THEN
    PERFORM upsert_roasted_inbound(p_session_id, v_user_id, p_inbound_grams,
                                   COALESCE(p_inbound_is_estimate, false));
  END IF;
END;
$$;


ALTER FUNCTION "public"."set_session_output_weight"("p_session_id" "uuid", "p_output_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_roasted_inbound"("p_session_id" "uuid", "p_user_id" "uuid", "p_grams" integer, "p_is_estimate" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_bean_id uuid;
  v_blend_id uuid;
  v_batch_id uuid;
BEGIN
  IF p_grams <= 0 THEN RETURN; END IF;

  SELECT s.bean_id, b.blend_id, s.plan_batch_id INTO v_bean_id, v_blend_id, v_batch_id
  FROM roast_sessions s
  LEFT JOIN roast_plan_batches b ON b.id = s.plan_batch_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM roasted_stock_events
    WHERE reference_id = v_batch_id AND event_type = 'roast_inbound'
  ) THEN RETURN; END IF;

  IF v_blend_id IS NOT NULL THEN
    v_bean_id := NULL;
  ELSIF v_bean_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO roasted_stock_events (user_id, bean_id, blend_id, delta_grams, event_type, reference_id, is_estimate, created_by)
  VALUES (p_user_id, v_bean_id, v_blend_id, p_grams, 'roast_inbound', p_session_id, p_is_estimate, auth.uid())
  ON CONFLICT (reference_id) WHERE event_type = 'roast_inbound'
  DO UPDATE SET delta_grams = EXCLUDED.delta_grams, is_estimate = EXCLUDED.is_estimate;
END;
$$;


ALTER FUNCTION "public"."upsert_roasted_inbound"("p_session_id" "uuid", "p_user_id" "uuid", "p_grams" integer, "p_is_estimate" boolean) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "polar_subscription_id" "text",
    "polar_product_id" "text",
    "status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "trial_end" timestamp with time zone,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "polar_checkout_id" "text",
    "amount" integer,
    "currency" "text",
    "recurring_interval" "text",
    "started_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."active_subscriptions" AS
 SELECT "id",
    "user_id",
    "polar_subscription_id",
    "polar_product_id",
    "polar_checkout_id",
    "status",
    "amount",
    "currency",
    "recurring_interval",
    "trial_end",
    "current_period_start",
    "current_period_end",
    "cancel_at_period_end",
    "started_at",
    "canceled_at",
    "ends_at",
    "created_at",
    "updated_at"
   FROM "public"."subscriptions"
  WHERE (("status" = ANY (ARRAY['active'::"text", 'trialing'::"text"])) AND (("current_period_end" IS NULL) OR ("current_period_end" > "now"())));


ALTER VIEW "public"."active_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bean_stock_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bean_id" "uuid" NOT NULL,
    "delta_grams" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "reference_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "cost_per_kg" numeric,
    CONSTRAINT "bean_stock_events_cost_per_kg_check" CHECK (("cost_per_kg" >= (0)::numeric)),
    CONSTRAINT "bean_stock_events_delta_sign_check" CHECK (((("event_type" = ANY (ARRAY['purchase'::"text", 'expected_inbound'::"text"])) AND ("delta_grams" > 0)) OR (("event_type" = ANY (ARRAY['roast'::"text", 'write_off'::"text"])) AND ("delta_grams" < 0)) OR ("event_type" = 'adjustment'::"text"))),
    CONSTRAINT "bean_stock_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['purchase'::"text", 'roast'::"text", 'adjustment'::"text", 'write_off'::"text", 'expected_inbound'::"text"])))
);


ALTER TABLE "public"."bean_stock_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "origin" "text",
    "low_stock_threshold_grams" integer DEFAULT 1000 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "region" "text",
    "farm" "text",
    "altitude_masl" integer,
    "process" "text",
    "variety" "text",
    "purchase_date" "date",
    "tasting_notes" "text",
    "capacity_grams" integer DEFAULT 5000 NOT NULL,
    "cost_per_kg" integer,
    "vendor" "text"
);


ALTER TABLE "public"."beans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blend_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blend_id" "uuid" NOT NULL,
    "bean_id" "uuid" NOT NULL,
    "ratio_pct" numeric NOT NULL,
    CONSTRAINT "positive_ratio" CHECK (("ratio_pct" > (0)::numeric))
);


ALTER TABLE "public"."blend_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."blends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cupping_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "held_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone
);


ALTER TABLE "public"."cupping_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cupping_events"."ended_at" IS 'When set, session is closed: no new samples/invites; public scoring rejected.';



CREATE TABLE IF NOT EXISTS "public"."cupping_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "roast_session_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "max_uses" integer DEFAULT 20 NOT NULL,
    "used_count" integer DEFAULT 0 NOT NULL,
    "revoked_at" timestamp with time zone,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sample_id" "uuid",
    "event_id" "uuid",
    CONSTRAINT "cupping_invites_max_uses_check" CHECK (("max_uses" > 0)),
    CONSTRAINT "cupping_invites_used_count_check" CHECK (("used_count" >= 0))
);


ALTER TABLE "public"."cupping_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cupping_samples" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "roast_session_id" "uuid",
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cupping_samples" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cuppings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "roast_session_id" "uuid",
    "roast_profile_id" "uuid",
    "form_version" "text" DEFAULT 'sca_v1'::"text" NOT NULL,
    "cupped_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cupped_by" "text",
    "scores" "jsonb" NOT NULL,
    "total_score" numeric(6,2) NOT NULL,
    "defects" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "descriptors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source" "text" DEFAULT 'web'::"text" NOT NULL,
    "invite_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sample_id" "uuid",
    CONSTRAINT "cuppings_defects_check" CHECK (("defects" >= 0)),
    CONSTRAINT "cuppings_source_check" CHECK (("source" = ANY (ARRAY['desktop'::"text", 'web'::"text", 'invite'::"text"])))
);


ALTER TABLE "public"."cuppings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_alert_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "users_processed" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    CONSTRAINT "inventory_alert_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."inventory_alert_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bean_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "current_grams" integer NOT NULL,
    "available_grams" integer NOT NULL,
    "reserved_grams" integer NOT NULL,
    "effective_grams" integer NOT NULL,
    "horizon_days" integer DEFAULT 28 NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dismissed_at" timestamp with time zone,
    CONSTRAINT "inventory_alerts_reason_check" CHECK (("reason" = ANY (ARRAY['out'::"text", 'schedule'::"text", 'low'::"text"])))
);


ALTER TABLE "public"."inventory_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."machine_connection_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "machine_id" "text",
    "roaster_key" "text" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "brand" "text" DEFAULT ''::"text" NOT NULL,
    "protocol" "text" NOT NULL,
    "params" "jsonb" DEFAULT '{}'::"jsonb",
    "success" boolean DEFAULT false NOT NULL,
    "error_message" "text",
    "duration_sec" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."machine_connection_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."machine_connection_logs" IS '로스터 하드웨어 연결 성공/실패/해제 기록';



COMMENT ON COLUMN "public"."machine_connection_logs"."params" IS '연결 파라미터 (host, port, comport 등)';



COMMENT ON COLUMN "public"."machine_connection_logs"."duration_sec" IS '연결 지속 시간 (해제 시에만 기록)';



CREATE TABLE IF NOT EXISTS "public"."order_dispatches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "carrier" "text" NOT NULL,
    "tracking_number" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "line_results" "jsonb",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "order_dispatches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'confirmed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."order_dispatches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "platform_line_id" "text" NOT NULL,
    "product_id" "uuid",
    "platform_product_id" "text",
    "platform_variant_id" "text",
    "title" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_price" numeric,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_lines_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "order_lines_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."order_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid",
    "user_id" "uuid",
    "trigger" "text" DEFAULT 'cron'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "orders_upserted" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    CONSTRAINT "order_sync_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'error'::"text", 'skipped'::"text"]))),
    CONSTRAINT "order_sync_runs_trigger_check" CHECK (("trigger" = ANY (ARRAY['cron'::"text", 'manual'::"text", 'webhook'::"text"])))
);


ALTER TABLE "public"."order_sync_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "connection_id" "uuid",
    "platform" "text" NOT NULL,
    "platform_order_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "fulfilled_at" timestamp with time zone,
    "ordered_at" timestamp with time zone NOT NULL,
    "buyer_name" "text",
    "currency" "text",
    "total_amount" numeric,
    "raw" "jsonb",
    "synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orders_platform_check" CHECK (("platform" = ANY (ARRAY['manual'::"text", 'naver'::"text", 'cafe24'::"text", 'shopify'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'preparing'::"text", 'shipped'::"text", 'delivered'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "seat_limit" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organizations_seat_limit_check" CHECK (("seat_limit" > 0))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."polar_coupons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "polar_discount_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "basis_points" integer,
    "amount_cents" integer,
    "currency" "text" DEFAULT 'usd'::"text",
    "duration" "text" NOT NULL,
    "duration_in_months" integer,
    "max_redemptions" integer DEFAULT 1 NOT NULL,
    "redemptions_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "batch_id" "uuid",
    "note" "text",
    "issued_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "disabled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_scope" "text" DEFAULT 'monthly'::"text" NOT NULL,
    CONSTRAINT "polar_coupons_duration_check" CHECK (("duration" = ANY (ARRAY['once'::"text", 'forever'::"text", 'repeating'::"text"]))),
    CONSTRAINT "polar_coupons_fixed_fields" CHECK ((("type" <> 'fixed'::"text") OR ("amount_cents" IS NOT NULL))),
    CONSTRAINT "polar_coupons_percentage_fields" CHECK ((("type" <> 'percentage'::"text") OR ("basis_points" IS NOT NULL))),
    CONSTRAINT "polar_coupons_product_scope_check" CHECK (("product_scope" = ANY (ARRAY['monthly'::"text", 'yearly'::"text", 'all'::"text"]))),
    CONSTRAINT "polar_coupons_repeating_months" CHECK ((("duration" <> 'repeating'::"text") OR ("duration_in_months" IS NOT NULL))),
    CONSTRAINT "polar_coupons_status_check" CHECK (("status" = ANY (ARRAY['idle'::"text", 'issued'::"text", 'redeemed'::"text", 'disabled'::"text"]))),
    CONSTRAINT "polar_coupons_type_check" CHECK (("type" = ANY (ARRAY['percentage'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."polar_coupons" OWNER TO "postgres";


COMMENT ON TABLE "public"."polar_coupons" IS 'Single-use Polar discount codes; idle pool issued by fc-admin.';



COMMENT ON COLUMN "public"."polar_coupons"."product_scope" IS 'Polar products filter: monthly | yearly | all (no product restriction)';



CREATE TABLE IF NOT EXISTS "public"."product_stock_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "delta_units" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "reference_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "product_stock_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['roast_inbound'::"text", 'order_fulfillment'::"text", 'order_cancel'::"text", 'adjustment'::"text", 'write_off'::"text"]))),
    CONSTRAINT "sign_by_type" CHECK (((("event_type" = ANY (ARRAY['roast_inbound'::"text", 'order_cancel'::"text"])) AND ("delta_units" > 0)) OR (("event_type" = ANY (ARRAY['order_fulfillment'::"text", 'write_off'::"text"])) AND ("delta_units" < 0)) OR (("event_type" = 'adjustment'::"text") AND ("delta_units" <> 0))))
);


ALTER TABLE "public"."product_stock_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sku" "text",
    "bean_id" "uuid",
    "blend_id" "uuid",
    "roast_profile_id" "uuid",
    "net_weight_grams" integer NOT NULL,
    "yield_pct" numeric DEFAULT 0.85 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_net_weight_grams_check" CHECK (("net_weight_grams" > 0)),
    CONSTRAINT "products_yield_pct_check" CHECK ((("yield_pct" > (0)::numeric) AND ("yield_pct" <= (1)::numeric))),
    CONSTRAINT "single_source" CHECK ((NOT (("bean_id" IS NOT NULL) AND ("blend_id" IS NOT NULL))))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "polar_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "business_name" "text",
    "business_registration_number" "text",
    "default_roast_profile_id" "uuid",
    "country_code" "text",
    CONSTRAINT "profiles_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'pro_plus'::"text", 'team'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."country_code" IS 'Billing market from Polar product (KR|US|JP). Set by landing polar webhook.';



CREATE TABLE IF NOT EXISTS "public"."recurrence_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rrule" "text" NOT NULL,
    "dtstart" "date" NOT NULL,
    "until" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "machine_id" "text",
    "roast_profile_id" "uuid",
    "bean_id" "uuid",
    "bean_name" "text" DEFAULT ''::"text" NOT NULL,
    "green_lot" "text" DEFAULT ''::"text" NOT NULL,
    "batch_size_kg" numeric DEFAULT 0 NOT NULL,
    "yield_pct" numeric DEFAULT 0 NOT NULL,
    "target_roasted_kg" numeric DEFAULT 0 NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "batch_type" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blend_id" "uuid",
    CONSTRAINT "recurrence_rules_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."recurrence_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roast_day_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roast_day_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roast_plan_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "bean_name" "text" NOT NULL,
    "roast_profile_id" "uuid",
    "machine_id" "text",
    "target_roasted_kg" numeric(6,2) NOT NULL,
    "batch_size_kg" numeric(6,2) NOT NULL,
    "batch_count" integer GENERATED ALWAYS AS ("ceil"(("target_roasted_kg" / "batch_size_kg"))) STORED NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bean_id" "uuid",
    "yield_pct" numeric(5,2) DEFAULT 82 NOT NULL,
    "batch_type" "text" DEFAULT 'Single Origin'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "green_lot" "text" DEFAULT ''::"text" NOT NULL,
    "rrule" "text",
    "recurrence_group_id" "uuid",
    "recurrence_rule_id" "uuid",
    "scheduled_date" "date",
    "original_date" "date",
    "exception_type" "text",
    "blend_id" "uuid",
    CONSTRAINT "roast_plan_batches_exception_type_check" CHECK (("exception_type" = ANY (ARRAY['modified'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "roast_plan_batches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in-progress'::"text", 'done'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."roast_plan_batches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."roast_plan_batches"."rrule" IS 'RFC 5545 RRULE string (e.g. FREQ=WEEKLY;INTERVAL=2 for biweekly). Null means no recurrence.';



COMMENT ON COLUMN "public"."roast_plan_batches"."recurrence_group_id" IS 'UUID grouping all batches created from the same recurrence rule. Null for single batches.';



CREATE TABLE IF NOT EXISTS "public"."roast_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "target_level" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "charge_temp_celsius" integer,
    "drop_temp_celsius" integer,
    "duration_sec" integer,
    "dev_time_sec" integer,
    "dev_pct" real,
    "source_session_id" "uuid",
    "default_bean_id" "uuid",
    "default_blend_id" "uuid",
    CONSTRAINT "roast_profiles_target_level_check" CHECK (("target_level" = ANY (ARRAY['Light'::"text", 'Medium-Light'::"text", 'Medium'::"text", 'Medium-Dark'::"text", 'Dark'::"text"])))
);


ALTER TABLE "public"."roast_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roasted_stock_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bean_id" "uuid",
    "blend_id" "uuid",
    "delta_grams" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "reference_id" "uuid",
    "note" "text",
    "is_estimate" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "delta_sign" CHECK (((("event_type" = ANY (ARRAY['roast_inbound'::"text", 'blend_produce'::"text"])) AND ("delta_grams" > 0)) OR (("event_type" = ANY (ARRAY['packaging'::"text", 'blend_consume'::"text", 'write_off'::"text"])) AND ("delta_grams" < 0)) OR (("event_type" = 'adjustment'::"text") AND ("delta_grams" <> 0)))),
    CONSTRAINT "roasted_stock_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['roast_inbound'::"text", 'packaging'::"text", 'blend_consume'::"text", 'blend_produce'::"text", 'adjustment'::"text", 'write_off'::"text"]))),
    CONSTRAINT "single_source" CHECK (("num_nonnulls"("bean_id", "blend_id") = 1))
);


ALTER TABLE "public"."roasted_stock_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_channel_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "shop_identifier" "text" NOT NULL,
    "display_name" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "last_error" "text",
    "consecutive_failures" integer DEFAULT 0 NOT NULL,
    "poll_cursor" "jsonb",
    "last_polled_at" timestamp with time zone,
    "webhook_registered" boolean DEFAULT false NOT NULL,
    "auto_fulfill_on_shipped" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_channel_connections_platform_check" CHECK (("platform" = ANY (ARRAY['naver'::"text", 'cafe24'::"text", 'shopify'::"text"]))),
    CONSTRAINT "sales_channel_connections_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'error'::"text", 'disabled'::"text"])))
);


ALTER TABLE "public"."sales_channel_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_channel_secrets" (
    "connection_id" "uuid" NOT NULL,
    "credentials" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_channel_secrets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bean_stock_events"
    ADD CONSTRAINT "bean_stock_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beans"
    ADD CONSTRAINT "beans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blend_components"
    ADD CONSTRAINT "blend_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blends"
    ADD CONSTRAINT "blends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cupping_events"
    ADD CONSTRAINT "cupping_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."cupping_samples"
    ADD CONSTRAINT "cupping_samples_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_alert_runs"
    ADD CONSTRAINT "inventory_alert_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_alerts"
    ADD CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_alerts"
    ADD CONSTRAINT "inventory_alerts_user_id_bean_id_reason_key" UNIQUE ("user_id", "bean_id", "reason");



ALTER TABLE ONLY "public"."machine_connection_logs"
    ADD CONSTRAINT "machine_connection_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_dispatches"
    ADD CONSTRAINT "order_dispatches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_sync_runs"
    ADD CONSTRAINT "order_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_key" UNIQUE ("owner_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."polar_coupons"
    ADD CONSTRAINT "polar_coupons_code_unique" UNIQUE ("code");



ALTER TABLE ONLY "public"."polar_coupons"
    ADD CONSTRAINT "polar_coupons_discount_unique" UNIQUE ("polar_discount_id");



ALTER TABLE ONLY "public"."polar_coupons"
    ADD CONSTRAINT "polar_coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_stock_events"
    ADD CONSTRAINT "product_stock_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_stripe_customer_id_key" UNIQUE ("polar_customer_id");



ALTER TABLE ONLY "public"."recurrence_rules"
    ADD CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roast_day_plans"
    ADD CONSTRAINT "roast_day_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roast_day_plans"
    ADD CONSTRAINT "roast_day_plans_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roast_profiles"
    ADD CONSTRAINT "roast_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roasted_stock_events"
    ADD CONSTRAINT "roasted_stock_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_channel_connections"
    ADD CONSTRAINT "sales_channel_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_channel_secrets"
    ADD CONSTRAINT "sales_channel_secrets_pkey" PRIMARY KEY ("connection_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("polar_subscription_id");



ALTER TABLE ONLY "public"."blend_components"
    ADD CONSTRAINT "unique_bean_per_blend" UNIQUE ("blend_id", "bean_id");



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "unique_line_per_order" UNIQUE ("order_id", "platform_line_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "unique_platform_order" UNIQUE ("user_id", "platform", "platform_order_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "unique_sku_per_user" UNIQUE ("user_id", "sku");



ALTER TABLE ONLY "public"."sales_channel_connections"
    ADD CONSTRAINT "unique_user_platform_shop" UNIQUE ("user_id", "platform", "shop_identifier");



CREATE UNIQUE INDEX "bean_stock_events_reference_bean_unique" ON "public"."bean_stock_events" USING "btree" ("reference_id", "bean_id") WHERE ("reference_id" IS NOT NULL);



CREATE INDEX "cupping_events_held_at_idx" ON "public"."cupping_events" USING "btree" ("held_at" DESC);



CREATE INDEX "cupping_events_user_id_idx" ON "public"."cupping_events" USING "btree" ("user_id");



CREATE INDEX "cupping_invites_event_id_idx" ON "public"."cupping_invites" USING "btree" ("event_id");



CREATE INDEX "cupping_invites_roast_session_id_idx" ON "public"."cupping_invites" USING "btree" ("roast_session_id");



CREATE INDEX "cupping_invites_sample_id_idx" ON "public"."cupping_invites" USING "btree" ("sample_id");



CREATE INDEX "cupping_invites_token_idx" ON "public"."cupping_invites" USING "btree" ("token");



CREATE INDEX "cupping_invites_user_id_idx" ON "public"."cupping_invites" USING "btree" ("user_id");



CREATE INDEX "cupping_samples_event_id_idx" ON "public"."cupping_samples" USING "btree" ("event_id");



CREATE INDEX "cupping_samples_roast_session_id_idx" ON "public"."cupping_samples" USING "btree" ("roast_session_id");



CREATE INDEX "cupping_samples_user_id_idx" ON "public"."cupping_samples" USING "btree" ("user_id");



CREATE INDEX "cuppings_roast_profile_id_idx" ON "public"."cuppings" USING "btree" ("roast_profile_id");



CREATE INDEX "cuppings_roast_session_id_idx" ON "public"."cuppings" USING "btree" ("roast_session_id");



CREATE INDEX "cuppings_sample_id_idx" ON "public"."cuppings" USING "btree" ("sample_id");



CREATE INDEX "cuppings_user_id_idx" ON "public"."cuppings" USING "btree" ("user_id");



CREATE UNIQUE INDEX "order_dispatches_active_unique" ON "public"."order_dispatches" USING "btree" ("order_id");



CREATE INDEX "order_dispatches_status_idx" ON "public"."order_dispatches" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text"]));



CREATE INDEX "order_dispatches_user_idx" ON "public"."order_dispatches" USING "btree" ("user_id");



CREATE INDEX "order_lines_product_idx" ON "public"."order_lines" USING "btree" ("product_id") WHERE ("product_id" IS NOT NULL);



CREATE INDEX "order_lines_user_idx" ON "public"."order_lines" USING "btree" ("user_id");



CREATE INDEX "orders_user_ordered_idx" ON "public"."orders" USING "btree" ("user_id", "ordered_at" DESC);



CREATE INDEX "organization_invites_org_id_idx" ON "public"."organization_invites" USING "btree" ("org_id");



CREATE INDEX "organization_members_user_id_idx" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "polar_coupons_batch_id_idx" ON "public"."polar_coupons" USING "btree" ("batch_id") WHERE ("batch_id" IS NOT NULL);



CREATE INDEX "polar_coupons_status_created_idx" ON "public"."polar_coupons" USING "btree" ("status", "created_at");



CREATE INDEX "product_stock_events_product_idx" ON "public"."product_stock_events" USING "btree" ("product_id");



CREATE UNIQUE INDEX "product_stock_events_reference_unique" ON "public"."product_stock_events" USING "btree" ("reference_id", "product_id", "event_type") WHERE ("reference_id" IS NOT NULL);



CREATE UNIQUE INDEX "roasted_adjust_ref_unique" ON "public"."roasted_stock_events" USING "btree" ("reference_id") WHERE (("event_type" = ANY (ARRAY['adjustment'::"text", 'write_off'::"text"])) AND ("reference_id" IS NOT NULL));



CREATE UNIQUE INDEX "roasted_blend_consume_ref_unique" ON "public"."roasted_stock_events" USING "btree" ("reference_id", "bean_id") WHERE ("event_type" = 'blend_consume'::"text");



CREATE UNIQUE INDEX "roasted_blend_produce_ref_unique" ON "public"."roasted_stock_events" USING "btree" ("reference_id") WHERE ("event_type" = 'blend_produce'::"text");



CREATE UNIQUE INDEX "roasted_inbound_session_unique" ON "public"."roasted_stock_events" USING "btree" ("reference_id") WHERE ("event_type" = 'roast_inbound'::"text");



CREATE UNIQUE INDEX "roasted_packaging_ref_unique" ON "public"."roasted_stock_events" USING "btree" ("reference_id") WHERE ("event_type" = 'packaging'::"text");



CREATE INDEX "roasted_stock_events_user_idx" ON "public"."roasted_stock_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "sales_channel_connections_active_poll_idx" ON "public"."sales_channel_connections" USING "btree" ("status") WHERE ("status" = 'active'::"text");



CREATE INDEX "sales_channel_connections_user_idx" ON "public"."sales_channel_connections" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "beans_updated_at" BEFORE UPDATE ON "public"."beans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE CONSTRAINT TRIGGER "blend_components_ratio_sum" AFTER INSERT OR DELETE OR UPDATE ON "public"."blend_components" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."check_blend_ratio_sum"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "roast_profiles_updated_at" BEFORE UPDATE ON "public"."roast_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "roast_sessions_updated_at" BEFORE UPDATE ON "public"."roast_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "subscriptions_set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_day_plans_updated_at" BEFORE UPDATE ON "public"."roast_day_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_deduct_bean_stock_on_roast" AFTER UPDATE ON "public"."roast_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."deduct_bean_stock_on_roast"();



CREATE OR REPLACE TRIGGER "trg_plan_batches_updated_at" BEFORE UPDATE ON "public"."roast_plan_batches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."bean_stock_events"
    ADD CONSTRAINT "bean_stock_events_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bean_stock_events"
    ADD CONSTRAINT "bean_stock_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bean_stock_events"
    ADD CONSTRAINT "bean_stock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beans"
    ADD CONSTRAINT "beans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blend_components"
    ADD CONSTRAINT "blend_components_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blend_components"
    ADD CONSTRAINT "blend_components_blend_id_fkey" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blends"
    ADD CONSTRAINT "blends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_events"
    ADD CONSTRAINT "cupping_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."cupping_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_roast_session_id_fkey" FOREIGN KEY ("roast_session_id") REFERENCES "public"."roast_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "public"."cupping_samples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_invites"
    ADD CONSTRAINT "cupping_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_samples"
    ADD CONSTRAINT "cupping_samples_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."cupping_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cupping_samples"
    ADD CONSTRAINT "cupping_samples_roast_session_id_fkey" FOREIGN KEY ("roast_session_id") REFERENCES "public"."roast_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cupping_samples"
    ADD CONSTRAINT "cupping_samples_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "public"."cupping_invites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_roast_profile_id_fkey" FOREIGN KEY ("roast_profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_roast_session_id_fkey" FOREIGN KEY ("roast_session_id") REFERENCES "public"."roast_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "public"."cupping_samples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuppings"
    ADD CONSTRAINT "cuppings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_alerts"
    ADD CONSTRAINT "inventory_alerts_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_alerts"
    ADD CONSTRAINT "inventory_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_connection_logs"
    ADD CONSTRAINT "machine_connection_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_dispatches"
    ADD CONSTRAINT "order_dispatches_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."sales_channel_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_dispatches"
    ADD CONSTRAINT "order_dispatches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_dispatches"
    ADD CONSTRAINT "order_dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_dispatches"
    ADD CONSTRAINT "order_dispatches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_sync_runs"
    ADD CONSTRAINT "order_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."sales_channel_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_sync_runs"
    ADD CONSTRAINT "order_sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."sales_channel_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stock_events"
    ADD CONSTRAINT "product_stock_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_stock_events"
    ADD CONSTRAINT "product_stock_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stock_events"
    ADD CONSTRAINT "product_stock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_blend_id_fkey" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_roast_profile_id_fkey" FOREIGN KEY ("roast_profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_default_roast_profile_id_fkey" FOREIGN KEY ("default_roast_profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurrence_rules"
    ADD CONSTRAINT "recurrence_rules_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurrence_rules"
    ADD CONSTRAINT "recurrence_rules_blend_id_fkey" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurrence_rules"
    ADD CONSTRAINT "recurrence_rules_roast_profile_id_fkey" FOREIGN KEY ("roast_profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurrence_rules"
    ADD CONSTRAINT "recurrence_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roast_day_plans"
    ADD CONSTRAINT "roast_day_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_blend_id_fkey" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."roast_day_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "public"."recurrence_rules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_plan_batches"
    ADD CONSTRAINT "roast_plan_batches_roast_profile_id_fkey" FOREIGN KEY ("roast_profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_profiles"
    ADD CONSTRAINT "roast_profiles_default_bean_id_fkey" FOREIGN KEY ("default_bean_id") REFERENCES "public"."beans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_profiles"
    ADD CONSTRAINT "roast_profiles_default_blend_id_fkey" FOREIGN KEY ("default_blend_id") REFERENCES "public"."blends"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_profiles"
    ADD CONSTRAINT "roast_profiles_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "public"."roast_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_profiles"
    ADD CONSTRAINT "roast_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_plan_batch_id_fkey" FOREIGN KEY ("plan_batch_id") REFERENCES "public"."roast_plan_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roast_sessions"
    ADD CONSTRAINT "roast_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roasted_stock_events"
    ADD CONSTRAINT "roasted_stock_events_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "public"."beans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roasted_stock_events"
    ADD CONSTRAINT "roasted_stock_events_blend_id_fkey" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roasted_stock_events"
    ADD CONSTRAINT "roasted_stock_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roasted_stock_events"
    ADD CONSTRAINT "roasted_stock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_channel_connections"
    ADD CONSTRAINT "sales_channel_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_channel_secrets"
    ADD CONSTRAINT "sales_channel_secrets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."sales_channel_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own profile" ON "public"."profiles" FOR DELETE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert their own connection logs" ON "public"."machine_connection_logs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own beans" ON "public"."beans" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own roast profiles" ON "public"."roast_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own roast sessions" ON "public"."roast_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own subscriptions" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own connection logs" ON "public"."machine_connection_logs" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."bean_stock_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blend_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cupping_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cupping_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cupping_samples" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cuppings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_alert_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_connection_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_dispatches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org collaborators can view co-member profiles" ON "public"."profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "me"
     JOIN "public"."organization_members" "them" ON (("them"."org_id" = "me"."org_id")))
  WHERE (("me"."user_id" = "auth"."uid"()) AND ("them"."user_id" = "profiles"."id")))));



CREATE POLICY "org_invites select owner" ON "public"."organization_invites" FOR SELECT USING ("public"."is_org_owner"("org_id"));



CREATE POLICY "org_members delete owner or self" ON "public"."organization_members" FOR DELETE USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_owner"("org_id")));



CREATE POLICY "org_members select self or owner" ON "public"."organization_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_owner"("org_id")));



ALTER TABLE "public"."organization_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs select member or owner" ON "public"."organizations" FOR SELECT USING ("public"."is_org_member_or_owner"("id"));



ALTER TABLE "public"."polar_coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_stock_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurrence_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roast_day_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roast_plan_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roast_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roast_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roasted_stock_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_channel_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_channel_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can manage own day plans" ON "public"."roast_day_plans" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users can manage own plan batches" ON "public"."roast_plan_batches" USING ((EXISTS ( SELECT 1
   FROM "public"."roast_day_plans" "p"
  WHERE (("p"."id" = "roast_plan_batches"."plan_id") AND ("p"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."roast_day_plans" "p"
  WHERE (("p"."id" = "roast_plan_batches"."plan_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "users see own roasted stock events" ON "public"."roasted_stock_events" USING ("public"."has_workspace_access"("user_id")) WITH CHECK (("public"."has_workspace_access"("user_id") AND ((("bean_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beans"
  WHERE (("beans"."id" = "roasted_stock_events"."bean_id") AND "public"."has_workspace_access"("beans"."user_id"))))) OR (("blend_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."blends"
  WHERE (("blends"."id" = "roasted_stock_events"."blend_id") AND "public"."has_workspace_access"("blends"."user_id"))))))));



CREATE POLICY "users see own stock events" ON "public"."bean_stock_events" USING ("public"."has_workspace_access"("user_id")) WITH CHECK (("public"."has_workspace_access"("user_id") AND (EXISTS ( SELECT 1
   FROM "public"."beans"
  WHERE (("beans"."id" = "bean_stock_events"."bean_id") AND "public"."has_workspace_access"("beans"."user_id"))))));



CREATE POLICY "workspace access beans" ON "public"."beans" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access blend_components" ON "public"."blend_components" USING (("blend_id" IN ( SELECT "blends"."id"
   FROM "public"."blends"
  WHERE "public"."has_workspace_access"("blends"."user_id")))) WITH CHECK (("blend_id" IN ( SELECT "blends"."id"
   FROM "public"."blends"
  WHERE "public"."has_workspace_access"("blends"."user_id"))));



CREATE POLICY "workspace access blends" ON "public"."blends" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access cupping_events" ON "public"."cupping_events" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access cupping_invites" ON "public"."cupping_invites" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access cupping_samples" ON "public"."cupping_samples" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access cuppings" ON "public"."cuppings" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access inventory_alerts" ON "public"."inventory_alerts" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access order_dispatches" ON "public"."order_dispatches" FOR SELECT USING ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access order_lines" ON "public"."order_lines" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access order_sync_runs" ON "public"."order_sync_runs" FOR SELECT USING ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access orders" ON "public"."orders" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access product_stock_events" ON "public"."product_stock_events" USING ("public"."has_workspace_access"("user_id")) WITH CHECK (("public"."has_workspace_access"("user_id") AND (EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "product_stock_events"."product_id") AND "public"."has_workspace_access"("p"."user_id"))))));



CREATE POLICY "workspace access products" ON "public"."products" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access recurrence_rules" ON "public"."recurrence_rules" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access roast_profiles" ON "public"."roast_profiles" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access roast_sessions" ON "public"."roast_sessions" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "workspace access sales_channel_connections" ON "public"."sales_channel_connections" USING ("public"."has_workspace_access"("user_id")) WITH CHECK ("public"."has_workspace_access"("user_id"));



CREATE POLICY "본인 구독 조회" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "본인 프로필 수정" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "본인 프로필 조회" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."add_bean_stock_on_purchase"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_auth_session_ips"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_auth_session_ips"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_auth_user_activity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_auth_user_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_user_roster"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_user_roster"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_plan_batch_count"("p_target_roasted_kg" numeric, "p_batch_size_kg" numeric, "p_yield_pct" numeric, "p_batch_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_plan_batch_count"("p_target_roasted_kg" numeric, "p_batch_size_kg" numeric, "p_yield_pct" numeric, "p_batch_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_order"("p_order_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."check_blend_ratio_sum"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_inventory_alerts"("p_user_id" "uuid", "p_horizon_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_inventory_alerts"("p_user_id" "uuid", "p_horizon_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_inventory_alerts_for_all_users"("p_horizon_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_org_invite"("p_token" "text", "p_expires_in" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_org_invite"("p_token" "text", "p_expires_in" interval) TO "authenticated";



GRANT ALL ON FUNCTION "public"."deduct_bean_stock_on_roast"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_roast_session"("p_session_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."expand_rrule_in_range"("p_rrule" "text", "p_dtstart" "date", "p_range_start" "date", "p_range_end" "date", "p_until" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."expand_rrule_in_range"("p_rrule" "text", "p_dtstart" "date", "p_range_start" "date", "p_range_end" "date", "p_until" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fulfill_order"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fulfill_order"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bean_available_stock"("p_bean_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bean_available_stock"("p_bean_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bean_current_stock"("p_bean_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bean_current_stock"("p_bean_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bean_effective_stock"("p_bean_id" "uuid", "p_horizon_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bean_effective_stock"("p_bean_id" "uuid", "p_horizon_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bean_reserved_stock"("p_bean_id" "uuid", "p_horizon_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bean_reserved_stock"("p_bean_id" "uuid", "p_horizon_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bean_stock_summary"("p_bean_id" "uuid", "p_horizon_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bean_stock_summary"("p_bean_id" "uuid", "p_horizon_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_product_current_stock"("p_product_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_roasting_requirements"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_product_stock"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_roasted_stock"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_user_stock_summaries"("p_user_id" "uuid", "p_horizon_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_stock_summaries"("p_user_id" "uuid", "p_horizon_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_workspace_access"("target_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_workspace_access"("target_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_workspace_access"("target_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_packaging_op"("p_product_events" "jsonb", "p_roasted_events" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."insert_product_stock_events_batch"("p_events" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."insert_roasted_stock_events_batch"("p_events" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."insert_stock_events_batch"("p_events" "jsonb", "p_roasted_events" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_org_member_or_owner"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_member_or_owner"("p_org_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_org_owner"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_owner"("p_org_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_org_members"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_org_members"("p_org_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."notify_signup_slack"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."redeem_org_invite"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redeem_org_invite"("p_token" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_member_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."replace_blend_components"("p_blend_id" "uuid", "p_components" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."revoke_org_invite"("p_invite_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_org_invite"("p_invite_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."roast_deduction_blocked"("p_reference_id" "uuid") TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roast_sessions" TO "anon";
GRANT ALL ON TABLE "public"."roast_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."roast_sessions" TO "service_role";



GRANT ALL ON FUNCTION "public"."save_roast_op"("p_session" "jsonb", "p_deduct" boolean, "p_deduction_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_session_output_weight"("p_session_id" "uuid", "p_output_grams" integer, "p_inbound_grams" integer, "p_inbound_is_estimate" boolean) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_roasted_inbound"("p_session_id" "uuid", "p_user_id" "uuid", "p_grams" integer, "p_is_estimate" boolean) TO "authenticated";
























GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."active_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."active_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."active_subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bean_stock_events" TO "anon";
GRANT ALL ON TABLE "public"."bean_stock_events" TO "authenticated";
GRANT ALL ON TABLE "public"."bean_stock_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."beans" TO "anon";
GRANT ALL ON TABLE "public"."beans" TO "authenticated";
GRANT ALL ON TABLE "public"."beans" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."blend_components" TO "anon";
GRANT ALL ON TABLE "public"."blend_components" TO "authenticated";
GRANT ALL ON TABLE "public"."blend_components" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."blends" TO "anon";
GRANT ALL ON TABLE "public"."blends" TO "authenticated";
GRANT ALL ON TABLE "public"."blends" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cupping_events" TO "anon";
GRANT ALL ON TABLE "public"."cupping_events" TO "authenticated";
GRANT ALL ON TABLE "public"."cupping_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cupping_invites" TO "anon";
GRANT ALL ON TABLE "public"."cupping_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."cupping_invites" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cupping_samples" TO "anon";
GRANT ALL ON TABLE "public"."cupping_samples" TO "authenticated";
GRANT ALL ON TABLE "public"."cupping_samples" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cuppings" TO "anon";
GRANT ALL ON TABLE "public"."cuppings" TO "authenticated";
GRANT ALL ON TABLE "public"."cuppings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_alert_runs" TO "anon";
GRANT ALL ON TABLE "public"."inventory_alert_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_alert_runs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_alerts" TO "anon";
GRANT ALL ON TABLE "public"."inventory_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_alerts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."machine_connection_logs" TO "anon";
GRANT ALL ON TABLE "public"."machine_connection_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_connection_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_dispatches" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_dispatches" TO "authenticated";
GRANT ALL ON TABLE "public"."order_dispatches" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_lines" TO "anon";
GRANT ALL ON TABLE "public"."order_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."order_lines" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_sync_runs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."order_sync_runs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_invites" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invites" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_members" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."polar_coupons" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."polar_coupons" TO "authenticated";
GRANT ALL ON TABLE "public"."polar_coupons" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_stock_events" TO "anon";
GRANT ALL ON TABLE "public"."product_stock_events" TO "authenticated";
GRANT ALL ON TABLE "public"."product_stock_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recurrence_rules" TO "anon";
GRANT ALL ON TABLE "public"."recurrence_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."recurrence_rules" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roast_day_plans" TO "anon";
GRANT ALL ON TABLE "public"."roast_day_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."roast_day_plans" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roast_plan_batches" TO "anon";
GRANT ALL ON TABLE "public"."roast_plan_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."roast_plan_batches" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roast_profiles" TO "anon";
GRANT ALL ON TABLE "public"."roast_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."roast_profiles" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roasted_stock_events" TO "anon";
GRANT ALL ON TABLE "public"."roasted_stock_events" TO "authenticated";
GRANT ALL ON TABLE "public"."roasted_stock_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_channel_connections" TO "anon";
GRANT ALL ON TABLE "public"."sales_channel_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_channel_connections" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_channel_secrets" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_channel_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_channel_secrets" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































