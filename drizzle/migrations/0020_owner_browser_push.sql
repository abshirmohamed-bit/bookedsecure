CREATE TABLE public.owner_push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE, user_id uuid NOT NULL,
 token text NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 4096), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_push_devices TO authenticated;
GRANT ALL ON public.owner_push_devices TO service_role;
ALTER TABLE public.owner_push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_push_devices_owner ON public.owner_push_devices FOR ALL TO authenticated USING (user_id = auth.uid() AND business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner')) WITH CHECK (user_id = auth.uid() AND business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner'));
CREATE TABLE public.owner_push_settings (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE, sms_fallback boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.owner_push_settings TO authenticated;
GRANT ALL ON public.owner_push_settings TO service_role;
ALTER TABLE public.owner_push_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_push_settings_read ON public.owner_push_settings FOR SELECT TO authenticated USING (business_id = private.current_business_id());
CREATE POLICY owner_push_settings_insert ON public.owner_push_settings FOR INSERT TO authenticated WITH CHECK (business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner'));
CREATE POLICY owner_push_settings_update ON public.owner_push_settings FOR UPDATE TO authenticated USING (business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner')) WITH CHECK (business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner'));
CREATE TABLE public.owner_push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES public.owner_push_devices(id) ON DELETE CASCADE, alert_key text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','accepted','failed','unknown')), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(device_id, alert_key)
);
GRANT SELECT ON public.owner_push_deliveries TO authenticated;
GRANT ALL ON public.owner_push_deliveries TO service_role;
ALTER TABLE public.owner_push_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_push_deliveries_read ON public.owner_push_deliveries FOR SELECT TO authenticated USING (business_id = private.current_business_id() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner'));