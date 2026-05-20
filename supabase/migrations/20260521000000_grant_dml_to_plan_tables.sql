-- Grant DML privileges to authenticated role on plan tables
-- These were missing because the tables were created via raw SQL, not the Table Editor
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roast_day_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roast_plan_batches TO authenticated;
