-- Stamp the connected roaster onto roast_sessions at save, copy onto roast_profiles
-- when creating from a session. Local machine ids are TEXT (no machines table / no FK).
-- Name/brand/protocol/roaster_key are denormalized so a deleted local machine still reads.

alter table public.roast_sessions
  add column if not exists machine_id text null,
  add column if not exists machine_name text null,
  add column if not exists machine_roaster_key text null,
  add column if not exists machine_brand text null,
  add column if not exists machine_protocol text null;

comment on column public.roast_sessions.machine_id is
  'Local fc_machines id at roast save. Not a FK — machines are device-local.';
comment on column public.roast_sessions.machine_name is
  'Display name snapshot of the connected machine at roast save.';
comment on column public.roast_sessions.machine_roaster_key is
  'Sidecar roaster key snapshot at roast save.';
comment on column public.roast_sessions.machine_brand is
  'Brand snapshot of the connected machine at roast save.';
comment on column public.roast_sessions.machine_protocol is
  'Protocol snapshot of the connected machine at roast save.';

alter table public.roast_profiles
  add column if not exists machine_id text null,
  add column if not exists machine_name text null,
  add column if not exists machine_roaster_key text null,
  add column if not exists machine_brand text null,
  add column if not exists machine_protocol text null;

comment on column public.roast_profiles.machine_id is
  'Inherited from source session machine snapshot. Not a FK.';
comment on column public.roast_profiles.machine_name is
  'Inherited machine display name from source session.';
comment on column public.roast_profiles.machine_roaster_key is
  'Inherited sidecar roaster key from source session.';
comment on column public.roast_profiles.machine_brand is
  'Inherited machine brand from source session.';
comment on column public.roast_profiles.machine_protocol is
  'Inherited machine protocol from source session.';

-- save_roast_op lists columns explicitly — include the snapshot.
CREATE OR REPLACE FUNCTION save_roast_op(
  p_session jsonb,
  p_deduct boolean,
  p_deduction_grams integer,
  p_inbound_grams integer,
  p_inbound_is_estimate boolean
)
RETURNS roast_sessions
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_session roast_sessions;
  v_id uuid;
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

  v_id := NULLIF(p_session->>'id', '')::uuid;

  -- Retry of a committed save: side-effects were part of that TX — return as-is.
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_session FROM roast_sessions WHERE id = v_id;
    IF FOUND THEN
      RETURN v_session;
    END IF;
  END IF;

  INSERT INTO roast_sessions (
    id, user_id, weight_grams, output_weight_grams, status, roasted_at, duration_seconds,
    drop_temp_celsius, roast_level, scheduled_at, notes,
    ambient_temp_celsius, ambient_humidity_pct, bean_id, bean_label, profile_id,
    tsv_path, bbp_tsv_path, bbp_seconds, charge_temp_celsius, plan_batch_id, events,
    machine_id, machine_name, machine_roaster_key, machine_brand, machine_protocol,
    created_by
  ) VALUES (
    COALESCE(v_id, gen_random_uuid()),
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
    NULLIF(trim(COALESCE(p_session->>'bean_label', '')), ''),
    NULLIF(p_session->>'profile_id', '')::uuid,
    NULLIF(p_session->>'tsv_path', ''),
    NULLIF(p_session->>'bbp_tsv_path', ''),
    NULLIF(p_session->>'bbp_seconds', '')::integer,
    NULLIF(p_session->>'charge_temp_celsius', '')::integer,
    NULLIF(p_session->>'plan_batch_id', '')::uuid,
    COALESCE(p_session->'events', '[]'::jsonb),
    NULLIF(p_session->>'machine_id', ''),
    NULLIF(p_session->>'machine_name', ''),
    NULLIF(p_session->>'machine_roaster_key', ''),
    NULLIF(p_session->>'machine_brand', ''),
    NULLIF(p_session->>'machine_protocol', ''),
    auth.uid()
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING * INTO v_session;

  -- Lost a concurrent race on the same id — winner owns the side-effects.
  IF v_session.id IS NULL THEN
    SELECT * INTO v_session FROM roast_sessions WHERE id = v_id;
    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'session id conflict';
    END IF;
    RETURN v_session;
  END IF;

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

GRANT EXECUTE ON FUNCTION save_roast_op(jsonb, boolean, integer, integer, boolean) TO authenticated;
