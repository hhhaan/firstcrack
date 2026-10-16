-- batch_count follows calc_plan_batch_count, including yield.
-- The previous generated expression was ceil(target / size) and ignored yield.
-- The column is absent from earlier migrations and present on the hosted database,
-- so drop-if-exists then add works in both places. Inserts cannot set this column.

ALTER TABLE public.roast_plan_batches
  DROP COLUMN IF EXISTS batch_count;

ALTER TABLE public.roast_plan_batches
  ADD COLUMN batch_count integer
  GENERATED ALWAYS AS (
    CASE
      WHEN batch_size_kg <= 0 OR target_roasted_kg <= 0 THEN 1
      ELSE ceil(
        target_roasted_kg / (batch_size_kg * greatest(coalesce(yield_pct, 1), 0.0001))
      )::integer
    END
  ) STORED;

COMMENT ON COLUMN public.roast_plan_batches.batch_count IS
  'Generated. ceil(target / (size * yield)), or 1 when target or size is not positive. Matches calc_plan_batch_count.';
