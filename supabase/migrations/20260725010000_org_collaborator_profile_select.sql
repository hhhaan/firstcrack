-- Members need owner plan (and names) for workspace feature inheritance.
-- Owners need member display names in Team settings.
-- Existing policy: own profile only. Add collaborator SELECT (OR'd with own).

CREATE POLICY "org collaborators can view co-member profiles"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members me
      JOIN public.organization_members them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid()
        AND them.user_id = profiles.id
    )
  );
