CREATE TABLE public.affiliate_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  short_description text NOT NULL CHECK (char_length(short_description) BETWEEN 1 AND 280),
  image_url text,
  destination_url text NOT NULL CHECK (destination_url ~ '^https://'),
  price_label text,
  disclosure_label text NOT NULL DEFAULT 'Featured product',
  is_affiliate boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.affiliate_products TO authenticated;
GRANT ALL ON public.affiliate_products TO service_role;

ALTER TABLE public.affiliate_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signed in tenants read active affiliate products"
  ON public.affiliate_products FOR SELECT TO authenticated
  USING (is_active = true);

CREATE INDEX affiliate_products_active_order_idx
  ON public.affiliate_products (is_active, display_order, created_at DESC);

CREATE TRIGGER affiliate_products_updated
  BEFORE UPDATE ON public.affiliate_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.affiliate_product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.affiliate_products(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK (event_kind IN ('impression', 'click')),
  page_path text NOT NULL DEFAULT '/dashboard',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.affiliate_product_events TO authenticated;
GRANT ALL ON public.affiliate_product_events TO service_role;

ALTER TABLE public.affiliate_product_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "affiliate events read own business"
  ON public.affiliate_product_events FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

CREATE POLICY "affiliate events insert own business"
  ON public.affiliate_product_events FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE INDEX affiliate_product_events_business_created_idx
  ON public.affiliate_product_events (business_id, created_at DESC);
CREATE INDEX affiliate_product_events_product_kind_idx
  ON public.affiliate_product_events (product_id, event_kind, created_at DESC);