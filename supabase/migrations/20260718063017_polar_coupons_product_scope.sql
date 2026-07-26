-- Coupon product scope at create time (Polar discount.products filter)
ALTER TABLE public.polar_coupons
  ADD COLUMN IF NOT EXISTS product_scope text NOT NULL DEFAULT 'monthly'
    CHECK (product_scope IN ('monthly', 'yearly', 'all'));

COMMENT ON COLUMN public.polar_coupons.product_scope IS
  'Polar products filter: monthly | yearly | all (no product restriction)';
