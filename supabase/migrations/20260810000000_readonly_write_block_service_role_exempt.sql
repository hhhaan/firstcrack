-- #124 — exempt server automation from the read_only / expired-trial write block.
--
-- Problem: trg_readonly_write_block (20260724000002) fires on every write to the 7 gated
-- tables regardless of the connection role. The order-sync Edge Function writes with the
-- service role (functions/order-sync/index.ts → _shared/channels/normalize.ts →
-- insert_product_stock_events_batch), so a read_only / expired-trial owner made the RPC
-- RAISE, the sync run throw, consecutive_failures climb and the channel connection flip to
-- status='error' — a cascading failure with no user action involved. Orders/order_lines are
-- not gated tables, so orders were already committed when the stock batch blew up.
--
-- Fix (issue #124, option (b)): the gate exists to block USER writes. Server automation is
-- not its target. Both trigger functions now return early unless the caller is the
-- 'authenticated' role.
--
-- Role semantics of `auth.role() IS DISTINCT FROM 'authenticated'`:
--   * authenticated  — desktop/client writes: NOT exempt, gate behaviour unchanged.
--   * service_role   — PostgREST sets the JWT claim GUC that auth.role() reads, so Edge
--                      Function writes are exempt. insert_product_stock_events_batch is
--                      SECURITY INVOKER (20260802000002), so it executes as service_role
--                      and the exemption reaches this BEFORE trigger.
--   * postgres/psql  — no JWT GUC → auth.role() is NULL → `NULL IS DISTINCT FROM
--                      'authenticated'` is TRUE → exempt. Intended: migrations/backfills.
--   * anon           — also exempt by this predicate, but not a hole: anon holds no
--                      table-level DML on the gated tables (20260710133123 granted
--                      ALL ON ALL TABLES only to postgres, service_role) and RLS applies.
--
-- CREATE OR REPLACE only — no DROP, so existing ACLs/GRANTs and the triggers that bind these
-- functions by name are preserved. Function body change only; no schema type change, so
-- database.types.ts is unaffected (SKIP_TYPES_GEN=1 applies at commit time).

CREATE OR REPLACE FUNCTION public.enforce_profile_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  gate_err text;
BEGIN
  -- #124: gate USER writes only; service_role / postgres automation is exempt.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_user := COALESCE(NEW.user_id, OLD.user_id);
  gate_err := public.profile_write_error(v_user);
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;

-- roast_plan_batches has no user_id — resolve owner through the parent day plan.
CREATE OR REPLACE FUNCTION public.enforce_profile_writable_plan_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  gate_err text;
BEGIN
  -- #124: gate USER writes only; service_role / postgres automation is exempt.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_user FROM public.roast_day_plans
  WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);

  gate_err := public.profile_write_error(v_user);
  IF gate_err IS NOT NULL THEN
    RAISE EXCEPTION '%', gate_err
      USING ERRCODE = 'check_violation',
            DETAIL = format('table=%s user=%s', TG_TABLE_NAME, v_user);
  END IF;
  RETURN NEW;
END;
$$;
