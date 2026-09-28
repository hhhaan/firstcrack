-- Atomic blend header + components.
-- Client contract (do not reword without updating blendWriteErrorMessage):
--   blend_duplicate_bean
--   blend_ratio_sum
--   blend_invalid_components
--   blend_components_required
--   blend_name_required
--   workspace access denied
--   blend not found or access denied
-- replace_blend_components stays for older clients. Rollback is DROP FUNCTION
-- (no data rewrite). Roll the app back with it — new clients call save_blend.

CREATE OR REPLACE FUNCTION public.save_blend(
  p_name text,
  p_components jsonb,
  p_user_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_description text;
  v_count integer;
  v_distinct integer;
  v_sum numeric;
BEGIN
  v_name := btrim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'blend_name_required';
  END IF;

  IF p_components IS NULL
     OR jsonb_typeof(p_components) <> 'array'
     OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'blend_components_required';
  END IF;

  -- Shape check before any write so a bad payload cannot leave a header behind.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_components) AS c
    WHERE jsonb_typeof(c) <> 'object'
       OR jsonb_typeof(c->'bean_id') <> 'string'
       OR jsonb_typeof(c->'ratio_pct') <> 'number'
       OR (c->>'bean_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (c->>'ratio_pct')::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'blend_invalid_components';
  END IF;

  SELECT count(*),
         count(DISTINCT (c->>'bean_id')::uuid),
         COALESCE(sum((c->>'ratio_pct')::numeric), 0)
    INTO v_count, v_distinct, v_sum
  FROM jsonb_array_elements(p_components) AS c;

  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'blend_duplicate_bean';
  END IF;

  IF v_sum <> 100 THEN
    RAISE EXCEPTION 'blend_ratio_sum';
  END IF;

  v_description := NULLIF(btrim(COALESCE(p_description, '')), '');

  IF p_id IS NULL THEN
    -- Same predicate as blends RLS: has_workspace_access(user_id).
    IF p_user_id IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
      RAISE EXCEPTION 'workspace access denied';
    END IF;

    INSERT INTO public.blends (user_id, name, description)
    VALUES (p_user_id, v_name, v_description)
    RETURNING id INTO v_id;
  ELSE
    SELECT b.id INTO v_id
    FROM public.blends b
    WHERE b.id = p_id
      AND public.has_workspace_access(b.user_id)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'blend not found or access denied';
    END IF;

    UPDATE public.blends
    SET name = v_name,
        description = v_description,
        updated_at = now()
    WHERE id = v_id;
  END IF;

  -- Same transaction as the header. Deferred ratio trigger sees the final sum.
  DELETE FROM public.blend_components WHERE blend_id = v_id;

  INSERT INTO public.blend_components (blend_id, bean_id, ratio_pct)
  SELECT v_id, (c->>'bean_id')::uuid, (c->>'ratio_pct')::numeric
  FROM jsonb_array_elements(p_components) AS c;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM ILIKE '%unique_bean_per_blend%' THEN
      RAISE EXCEPTION 'blend_duplicate_bean';
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_blend(text, jsonb, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_blend(text, jsonb, uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.save_blend(text, jsonb, uuid, text, uuid) IS
  'Insert or update a blend and its components in one transaction. SECURITY INVOKER; workspace check matches blends RLS.';
