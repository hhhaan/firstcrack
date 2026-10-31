DO $migration$
DECLARE before_policy jsonb; after_policy jsonb;
BEGIN
 SELECT to_jsonb(p) INTO before_policy FROM pg_policies p WHERE schemaname='public' AND tablename='profiles' AND policyname='org collaborators can view co-member profiles';
 IF before_policy IS NULL OR before_policy->'roles' <> '["public"]'::jsonb OR before_policy->>'cmd' <> 'SELECT' OR before_policy->>'permissive' <> 'PERMISSIVE' OR before_policy->>'with_check' IS NOT NULL THEN
 RAISE EXCEPTION 'Unexpected profile collaborator policy state; no change applied';
 END IF;
 IF pg_has_role('firstcrack_mcp_data','authenticated','member') OR has_table_privilege('firstcrack_mcp_data','public.organization_members','select') THEN
 RAISE EXCEPTION 'Unexpected MCP privilege state; no change applied';
 END IF;
 ALTER POLICY "org collaborators can view co-member profiles" ON public.profiles TO authenticated;
 SELECT to_jsonb(p) INTO after_policy FROM pg_policies p WHERE schemaname='public' AND tablename='profiles' AND policyname='org collaborators can view co-member profiles';
 IF (before_policy - 'roles') IS DISTINCT FROM (after_policy - 'roles') OR after_policy->'roles' <> '["authenticated"]'::jsonb THEN
 RAISE EXCEPTION 'Policy preservation assertion failed';
 END IF;
END
$migration$;
