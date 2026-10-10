-- Run against the pre-migration database with an existing profile UUID.
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(1, 10) n;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT public.get_user_stock_summaries(current_setting('test.owner')::uuid, 28);

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(11, 100) n;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT public.get_user_stock_summaries(current_setting('test.owner')::uuid, 28);

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(101, 1000) n;
INSERT INTO public.recurrence_rules(
  user_id, rrule, dtstart, "until", bean_name, bean_id,
  batch_size_kg, target_roasted_kg, yield_pct
)
SELECT current_setting('test.owner')::uuid,
       'FREQ=DAILY', CURRENT_DATE, CURRENT_DATE + 28,
       'stock explain recurrence', md5('stock-explain-' || n)::uuid,
       1, 0.8, 0.8
FROM generate_series(1, 100) n;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT public.get_user_stock_summaries(current_setting('test.owner')::uuid, 28);

ROLLBACK;
