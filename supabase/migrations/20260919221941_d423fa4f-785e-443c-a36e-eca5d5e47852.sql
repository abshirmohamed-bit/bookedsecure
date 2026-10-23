ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS trade text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_trade_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_trade_check CHECK (
    trade IS NULL OR trade IN (
      'auto_marine_detailing',
      'lawn_garden',
      'mobile_pet_grooming',
      'pool_servicing',
      'window_cleaning',
      'commercial_cleaning',
      'test_and_tag'
    )
  );