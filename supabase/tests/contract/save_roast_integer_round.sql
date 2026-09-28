-- #620: decimal strings for every integer column save_roast_op writes, plus the
-- deduction and inbound arguments. text::integer would reject these. Each value
-- must round the same way as duration_seconds (round(numeric)::integer).

BEGIN;
SELECT set_config('test.owner', :'owner', true);
SELECT set_config('request.jwt.claim.sub', :'owner', true);

DO $$
DECLARE
  owner_id uuid := current_setting('test.owner')::uuid;
  bean_id uuid;
  saved roast_sessions;
  green_delta integer;
  inbound_delta integer;
BEGIN
  INSERT INTO beans (user_id, name) VALUES (owner_id, 'contract lot') RETURNING id INTO bean_id;

  saved := save_roast_op(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'user_id', owner_id,
      'bean_id', bean_id,
      'weight_grams', '1000.6',
      'output_weight_grams', '850.4',
      'duration_seconds', '686.6',
      'drop_temp_celsius', '205.4',
      'charge_temp_celsius', '180.6',
      'bbp_seconds', '92.5',
      'roasted_at', now(),
      'status', 'completed'
    ),
    true,
    1000.6,
    850.4,
    false
  );

  ASSERT saved.weight_grams = 1001, 'weight_grams';
  ASSERT saved.output_weight_grams = 850, 'output_weight_grams';
  ASSERT saved.duration_seconds = 687, 'duration_seconds';
  ASSERT saved.drop_temp_celsius = 205, 'drop_temp_celsius';
  ASSERT saved.charge_temp_celsius = 181, 'charge_temp_celsius';
  ASSERT saved.bbp_seconds = 93, 'bbp_seconds';

  SELECT delta_grams INTO green_delta
  FROM bean_stock_events
  WHERE reference_id = saved.id AND event_type = 'roast';
  ASSERT green_delta = -1001, 'p_deduction_grams';

  SELECT delta_grams INTO inbound_delta
  FROM roasted_stock_events
  WHERE reference_id = saved.id AND event_type = 'roast_inbound';
  ASSERT inbound_delta = 850, 'p_inbound_grams';
END $$;

ROLLBACK;
