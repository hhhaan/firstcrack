-- Step 1: Create blends and blend_components tables
CREATE TABLE blends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blend_components (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blend_id  uuid NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
  bean_id   uuid NOT NULL REFERENCES beans(id),
  ratio_pct numeric NOT NULL,
  CONSTRAINT positive_ratio CHECK (ratio_pct > 0),
  CONSTRAINT unique_bean_per_blend UNIQUE (blend_id, bean_id)
);

ALTER TABLE blends ENABLE ROW LEVEL SECURITY;
ALTER TABLE blend_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own blends" ON blends
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users see own blend_components" ON blend_components
  FOR ALL USING (
    blend_id IN (SELECT id FROM blends WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON blends TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON blend_components TO authenticated;

-- Step 2: Create bean_stock_events table
CREATE TABLE bean_stock_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bean_id      uuid NOT NULL REFERENCES beans(id) ON DELETE CASCADE,
  delta_grams  integer NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('purchase', 'roast', 'adjustment')),
  reference_id uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bean_stock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own stock events" ON bean_stock_events
  FOR ALL USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON bean_stock_events TO authenticated;

-- Step 3: Add columns to existing tables
ALTER TABLE roast_profiles
  ADD COLUMN default_bean_id  uuid REFERENCES beans(id) ON DELETE SET NULL,
  ADD COLUMN default_blend_id uuid REFERENCES blends(id) ON DELETE SET NULL;

ALTER TABLE roast_plan_batches
  ADD COLUMN blend_id uuid REFERENCES blends(id) ON DELETE SET NULL;

-- Step 4: Migrate existing stock_grams to events
INSERT INTO bean_stock_events (user_id, bean_id, delta_grams, event_type, note)
SELECT user_id, id, stock_grams, 'purchase', 'Initial stock migration'
FROM beans
WHERE stock_grams > 0;
