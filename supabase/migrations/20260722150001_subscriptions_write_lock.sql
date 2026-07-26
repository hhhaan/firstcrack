-- subscriptions 쓰기는 polar-webhook(service_role) 전용. 클라이언트는 자기 행 SELECT만.
-- (fc-landing/docs/migrations/fix_subscriptions_rls.sql를 정식 파이프라인으로 편입)
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscriptions" ON public.subscriptions;

-- 20260710133123 restore_service_role_grants가 준 테이블 레벨 DML도 회수 (이중 방어).
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
