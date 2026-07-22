-- Polar single-use coupon pool (managed by fc-admin)
-- status: idle → issued → redeemed | disabled

CREATE TABLE IF NOT EXISTS public.polar_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  polar_discount_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('percentage', 'fixed')),
  basis_points integer,
  amount_cents integer,
  currency text DEFAULT 'usd',
  duration text NOT NULL CHECK (duration IN ('once', 'forever', 'repeating')),
  duration_in_months integer,
  max_redemptions integer NOT NULL DEFAULT 1,
  redemptions_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'issued', 'redeemed', 'disabled')),
  batch_id uuid,
  note text,
  issued_at timestamptz,
  redeemed_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT polar_coupons_code_unique UNIQUE (code),
  CONSTRAINT polar_coupons_discount_unique UNIQUE (polar_discount_id),
  CONSTRAINT polar_coupons_percentage_fields CHECK (
    type <> 'percentage' OR basis_points IS NOT NULL
  ),
  CONSTRAINT polar_coupons_fixed_fields CHECK (
    type <> 'fixed' OR amount_cents IS NOT NULL
  ),
  CONSTRAINT polar_coupons_repeating_months CHECK (
    duration <> 'repeating' OR duration_in_months IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS polar_coupons_status_created_idx
  ON public.polar_coupons (status, created_at ASC);

CREATE INDEX IF NOT EXISTS polar_coupons_batch_id_idx
  ON public.polar_coupons (batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON TABLE public.polar_coupons IS
  'Single-use Polar discount codes; idle pool issued by fc-admin.';

ALTER TABLE public.polar_coupons ENABLE ROW LEVEL SECURITY;

-- No client policies — service_role only (fc-admin BFF)
GRANT ALL ON public.polar_coupons TO postgres, service_role;
