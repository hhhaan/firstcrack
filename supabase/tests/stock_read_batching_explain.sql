-- Run after the migration with an existing profile UUID:
-- psql ... -v ON_ERROR_STOP=1 -v owner=... -f supabase/tests/stock_read_batching_explain.sql
BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

-- EXPLAIN the exact RETURN QUERY rather than the opaque PL/pgSQL Function Scan.
SELECT 'CREATE TEMP VIEW stock_summary_rows_plan AS ' ||
  replace(
    replace(
      replace(
        (regexp_match(
          pg_get_functiondef('public.get_stock_summary_rows(uuid,integer,uuid)'::regprocedure),
          '(?s)RETURN QUERY\s+(.*);\s*END;'
        ))[1],
        'p_horizon_days', '28'
      ),
      'p_bean_id', 'NULL::uuid'
    ),
    'v_owner_id', '(current_setting(''test.owner''))::uuid'
  )
FROM pg_proc
WHERE oid = 'public.get_stock_summary_rows(uuid,integer,uuid)'::regprocedure
\gexec

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(1, 10) n;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM stock_summary_rows_plan;

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(11, 100) n;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM stock_summary_rows_plan;

INSERT INTO public.beans(id, user_id, name)
SELECT md5('stock-explain-' || n)::uuid,
       current_setting('test.owner')::uuid,
       'stock explain ' || n
FROM generate_series(101, 1000) n;

-- Multiple dates per rule exercise set expansion independently of bean count.
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
SELECT * FROM stock_summary_rows_plan;

ROLLBACK;
