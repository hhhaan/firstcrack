-- profiles.plan CHECK only allowed free/pro/team, but plan-matrix.ts already
-- references pro_plus/enterprise tiers (order integration, multi-machine).
-- Widen the constraint to match.

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan = ANY (ARRAY['free'::text, 'pro'::text, 'pro_plus'::text, 'team'::text, 'enterprise'::text]));
