-- Concurrent publish repro for #736 D2. Run against a disposable local database:
-- psql ... -v owner=<profile uuid> -v setup=1 -f supabase/tests/cupping_write_concurrent.sql
-- psql ... -v publish_a=1 -v hold=1 -f ... & psql ... -v publish_b=1 -f ... & wait
-- psql ... -v verify_publish=1 -f supabase/tests/cupping_write_concurrent.sql
-- psql ... -v publish_a=1 -v hold=1 -f ... & psql ... -v legacy=1 -f ... & wait
-- psql ... -v verify_race=1 -f supabase/tests/cupping_write_concurrent.sql
\if :{?setup}
INSERT INTO public.roast_sessions(id, user_id, weight_grams, status)
VALUES ('73600000-2000-0000-0000-000000000001', :'owner', 1000, 'completed');
INSERT INTO public.cupping_events(id, user_id, title, form_snapshot)
VALUES ('73600000-2000-0000-0000-000000000003', :'owner', 'D concurrent', '{}');
INSERT INTO public.cupping_samples(id, event_id, user_id, roast_session_id, label)
VALUES ('73600000-2000-0000-0000-000000000004', '73600000-2000-0000-0000-000000000003',
  :'owner', '73600000-2000-0000-0000-000000000001', 'A');
INSERT INTO public.cupping_invites(id, token, user_id, event_id, expires_at)
VALUES ('73600000-2000-0000-0000-000000000005', 'd-concurrent', :'owner',
  '73600000-2000-0000-0000-000000000003', now() + interval '1 day');
INSERT INTO public.cupping_participants(id, invite_id, user_id, cupped_by)
VALUES ('73600000-2000-0000-0000-000000000006', '73600000-2000-0000-0000-000000000005',
  :'owner', 'Concurrent');
\elif :{?publish_a}
BEGIN;
SET LOCAL ROLE service_role;
SELECT id, created FROM public.write_cupping_scorecards_batch(
  '73600000-2000-0000-0000-000000000005', '73600000-2000-0000-0000-000000000006',
  'Concurrent', true,
  '[{"sample_id":"73600000-2000-0000-0000-000000000004","roast_session_id":"73600000-2000-0000-0000-000000000001","scores":{"aroma":8},"total_score":81,"defects":0,"descriptors":[]}]');
\echo ready
\if :{?hold}
SELECT pg_sleep(1);
\endif
COMMIT;
\elif :{?publish_b}
SET ROLE service_role;
SELECT id, created FROM public.write_cupping_scorecards_batch(
  '73600000-2000-0000-0000-000000000005', '73600000-2000-0000-0000-000000000006',
  'Concurrent', true,
  '[{"sample_id":"73600000-2000-0000-0000-000000000004","roast_session_id":"73600000-2000-0000-0000-000000000001","scores":{"aroma":7},"total_score":72,"defects":0,"descriptors":[]}]');
\elif :{?legacy}
SET ROLE service_role;
SELECT id, created FROM public.write_cupping_scorecards_batch(
  '73600000-2000-0000-0000-000000000005', '73600000-2000-0000-0000-000000000006',
  'Concurrent', false,
  '[{"sample_id":"73600000-2000-0000-0000-000000000004","roast_session_id":"73600000-2000-0000-0000-000000000001","scores":{"aroma":6},"total_score":60,"defects":0,"descriptors":[]}]');
\elif :{?verify_publish}
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.cuppings
    WHERE invite_id = '73600000-2000-0000-0000-000000000005') = 1;
  ASSERT (SELECT published_at FROM public.cupping_participants
    WHERE id = '73600000-2000-0000-0000-000000000006') IS NOT NULL;
  ASSERT (SELECT total_score FROM public.cuppings
    WHERE invite_id = '73600000-2000-0000-0000-000000000005') = 81,
    'losing publish overwrote the winner';
END $$;
DELETE FROM public.cuppings WHERE invite_id = '73600000-2000-0000-0000-000000000005';
UPDATE public.cupping_participants SET published_at = NULL
WHERE id = '73600000-2000-0000-0000-000000000006';
\elif :{?verify_race}
DO $$
BEGIN
  ASSERT (SELECT published_at FROM public.cupping_participants
    WHERE id = '73600000-2000-0000-0000-000000000006') IS NOT NULL;
  ASSERT (SELECT total_score FROM public.cuppings
    WHERE invite_id = '73600000-2000-0000-0000-000000000005') = 81,
    'legacy request overwrote published scores';
END $$;
DELETE FROM public.cupping_events WHERE id = '73600000-2000-0000-0000-000000000003';
DELETE FROM public.roast_sessions WHERE id = '73600000-2000-0000-0000-000000000001';
\else
\warn 'pass one documented phase variable'
\quit 1
\endif
