-- Load current counters with the profile cache; only saving increments them.
CREATE FUNCTION public.get_roast_batch_counters(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR NOT public.has_workspace_access(p_user_id) THEN
    RAISE EXCEPTION 'workspace access denied' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object('total', 0) || COALESCE(
      jsonb_object_agg(COALESCE(c.profile_id::text, 'total'), c.last_number), '{}'::jsonb
    ) FROM private.roast_batch_counters c WHERE c.user_id = p_user_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_roast_batch_counters(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_roast_batch_counters(uuid) TO authenticated;
