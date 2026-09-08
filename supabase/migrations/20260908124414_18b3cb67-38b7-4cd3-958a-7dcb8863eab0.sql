CREATE TABLE public.service_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_guidance text,
  duration_minutes integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.service_addon_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.service_addons(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (addon_id, service_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_addons TO authenticated;
GRANT ALL ON public.service_addons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_addon_links TO authenticated;
GRANT ALL ON public.service_addon_links TO service_role;

ALTER TABLE public.service_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_addon_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_addons_same_business" ON public.service_addons
  FOR ALL TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "service_addon_links_same_business" ON public.service_addon_links
  FOR ALL TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE INDEX service_addons_business_idx ON public.service_addons (business_id);
CREATE INDEX service_addon_links_service_idx ON public.service_addon_links (service_id);
CREATE INDEX service_addon_links_addon_idx ON public.service_addon_links (addon_id);

CREATE TRIGGER service_addons_set_updated_at
  BEFORE UPDATE ON public.service_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();