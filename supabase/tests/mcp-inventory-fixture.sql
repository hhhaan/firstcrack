-- Disposable fixture only; deliberately not a full Supabase migration replay.
-- Reuse isolated identities, current workspace predicates, RLS and opaque issuer.
\ir mcp-opaque-fixture.sql

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
   nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

CREATE TABLE public.blends(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users, name text);
CREATE TABLE public.blend_components(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blend_id uuid REFERENCES blends, bean_id uuid REFERENCES beans, ratio_pct numeric);
CREATE TABLE public.recurrence_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users, status text, dtstart date, until date);
ALTER TABLE blends ENABLE ROW LEVEL SECURITY;
ALTER TABLE blend_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurrence_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_access ON blends USING (public.has_workspace_access(user_id)) WITH CHECK (public.has_workspace_access(user_id));
CREATE POLICY workspace_access ON recurrence_rules USING (public.has_workspace_access(user_id)) WITH CHECK (public.has_workspace_access(user_id));
CREATE POLICY workspace_access ON blend_components USING (EXISTS (SELECT 1 FROM blends b WHERE b.id=blend_id AND public.has_workspace_access(b.user_id)));

ALTER TABLE roast_sessions
 ADD COLUMN bean_id uuid REFERENCES beans,
 ADD COLUMN blend_id uuid REFERENCES blends,
 ADD COLUMN profile_id uuid,
 ADD COLUMN plan_batch_id uuid REFERENCES roast_plan_batches,
 ADD COLUMN drop_temp_celsius integer,
 ADD COLUMN roast_level text,
 ADD COLUMN scheduled_at timestamptz,
 ADD COLUMN notes text,
 ADD COLUMN ambient_temp_celsius numeric,
 ADD COLUMN ambient_humidity_pct numeric,
 ADD COLUMN tsv_path text,
 ADD COLUMN bbp_tsv_path text,
 ADD COLUMN bbp_seconds integer,
 ADD COLUMN charge_temp_celsius integer,
 ADD COLUMN events jsonb,
 ADD COLUMN color_whole text,
 ADD COLUMN color_ground text,
 ADD COLUMN machine_id text,
 ADD COLUMN machine_name text,
 ADD COLUMN machine_roaster_key text,
 ADD COLUMN machine_brand text,
 ADD COLUMN machine_protocol text,
 ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users,
 ADD COLUMN profile_batch_number integer,
 ADD COLUMN total_batch_number integer;
ALTER TABLE roast_plan_batches
 ADD COLUMN bean_id uuid REFERENCES beans,
 ADD COLUMN blend_id uuid REFERENCES blends,
 ADD COLUMN recurrence_rule_id uuid REFERENCES recurrence_rules,
 ADD COLUMN exception_type text,
 ADD COLUMN original_date date;

UPDATE profiles SET plan='pro_plus';
UPDATE bean_stock_events SET event_type='purchase' WHERE event_type='inbound';
UPDATE products SET net_weight_grams=200, is_active=true, bean_id=id;
ALTER TABLE products ALTER COLUMN net_weight_grams SET NOT NULL;
ALTER TABLE products ADD CONSTRAINT net_weight CHECK(net_weight_grams > 0);
ALTER TABLE products ADD CONSTRAINT single_source CHECK(num_nonnulls(bean_id,blend_id) <= 1);
ALTER TABLE products ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE orders ADD COLUMN updated_at timestamptz;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['bean_stock_events','roasted_stock_events','product_stock_events'] LOOP
  EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid(), ADD COLUMN reference_id uuid, ADD COLUMN note text, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN created_by uuid DEFAULT auth.uid() REFERENCES auth.users', tab);
 END LOOP;
END $$;
ALTER TABLE bean_stock_events ADD COLUMN cost_per_kg numeric CHECK(cost_per_kg >= 0);
ALTER TABLE bean_stock_events ADD CONSTRAINT event_type_check CHECK(event_type IN ('purchase','roast','adjustment','write_off','expected_inbound'));
ALTER TABLE bean_stock_events ADD CONSTRAINT delta_sign CHECK((event_type IN ('purchase','expected_inbound') AND delta_grams > 0) OR (event_type IN ('roast','write_off') AND delta_grams < 0) OR (event_type='adjustment' AND delta_grams<>0));
ALTER TABLE roasted_stock_events ADD COLUMN event_type text NOT NULL DEFAULT 'adjustment', ADD COLUMN is_estimate boolean NOT NULL DEFAULT false;
ALTER TABLE roasted_stock_events ADD CONSTRAINT single_source CHECK(num_nonnulls(bean_id,blend_id)=1);
ALTER TABLE roasted_stock_events ADD CONSTRAINT delta_sign CHECK((event_type IN ('roast_inbound','blend_produce') AND delta_grams>0) OR (event_type IN ('packaging','blend_consume','write_off') AND delta_grams<0) OR (event_type='adjustment' AND delta_grams<>0));
ALTER TABLE product_stock_events ADD COLUMN event_type text NOT NULL DEFAULT 'adjustment';
ALTER TABLE product_stock_events ADD CONSTRAINT delta_sign CHECK((event_type IN ('roast_inbound','order_cancel') AND delta_units>0) OR (event_type IN ('order_fulfillment','write_off') AND delta_units<0) OR (event_type='adjustment' AND delta_units<>0));
CREATE UNIQUE INDEX bean_stock_reference ON bean_stock_events(reference_id,bean_id) WHERE reference_id IS NOT NULL;
CREATE UNIQUE INDEX roasted_inbound_reference ON roasted_stock_events(reference_id) WHERE event_type='roast_inbound';
CREATE UNIQUE INDEX roasted_packaging_ref_unique ON roasted_stock_events(reference_id) WHERE event_type='packaging';
CREATE UNIQUE INDEX roasted_blend_produce_ref_unique ON roasted_stock_events(reference_id) WHERE event_type='blend_produce';
CREATE UNIQUE INDEX roasted_blend_consume_ref_unique ON roasted_stock_events(reference_id,bean_id) WHERE event_type='blend_consume';
CREATE UNIQUE INDEX product_stock_reference ON product_stock_events(reference_id,product_id,event_type) WHERE reference_id IS NOT NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
