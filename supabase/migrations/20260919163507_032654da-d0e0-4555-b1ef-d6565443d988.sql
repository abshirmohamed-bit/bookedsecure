ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS quote_service_layout text NOT NULL DEFAULT 'focused_list';

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_quote_service_layout_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_quote_service_layout_check
  CHECK (quote_service_layout IN ('focused_list', 'compact_grid', 'guided_conversation'));

COMMENT ON COLUMN public.businesses.quote_service_layout IS
  'Tenant-selected presentation of services on the public AI quote page.';