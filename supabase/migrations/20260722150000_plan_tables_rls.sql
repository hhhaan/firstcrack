-- Plan tables: GRANT만 있고 RLS enable이 없었음 — 모든 인증 유저가 전체 플랜 R/W 가능했던 구멍.
ALTER TABLE public.roast_day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roast_plan_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace access day plans" ON public.roast_day_plans;
CREATE POLICY "workspace access day plans" ON public.roast_day_plans
  FOR ALL
  USING (public.has_workspace_access(user_id))
  WITH CHECK (public.has_workspace_access(user_id));

-- roast_plan_batches는 user_id가 없다 — 부모 plan을 통해 스코프.
DROP POLICY IF EXISTS "workspace access plan batches" ON public.roast_plan_batches;
CREATE POLICY "workspace access plan batches" ON public.roast_plan_batches
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.roast_day_plans p
    WHERE p.id = roast_plan_batches.plan_id
      AND public.has_workspace_access(p.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.roast_day_plans p
    WHERE p.id = roast_plan_batches.plan_id
      AND public.has_workspace_access(p.user_id)
  ));
