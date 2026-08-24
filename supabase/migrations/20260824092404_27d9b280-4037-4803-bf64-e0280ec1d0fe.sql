-- ENUMS
CREATE TYPE public.app_role AS ENUM ('owner', 'staff', 'platform_admin');

-- BUSINESSES
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  phone_number text,
  service_area text,
  opening_hours text,
  default_sms_provider text NOT NULL DEFAULT 'simulated',
  sms_signature text,
  privacy_policy_url text,
  automation_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start integer NOT NULL DEFAULT 21,
  quiet_hours_end integer NOT NULL DEFAULT 8,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- HELPERS
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT business_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- LEADS
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  mobile_number text NOT NULL,
  email text,
  suburb text,
  vehicle_type text,
  last_cleaned_at text,
  main_concerns text,
  service_intent text,
  source_channel text NOT NULL DEFAULT 'unknown',
  source_campaign text,
  source_form text,
  utm_source text,
  utm_campaign text,
  status text NOT NULL DEFAULT 'new',
  readiness_classification text,
  consent_record jsonb,
  opted_out_at timestamptz,
  first_contacted_at timestamptz,
  first_reply_at timestamptz,
  assigned_to uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_business_idx ON public.leads (business_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CONVERSATIONS
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  next_follow_up_at timestamptz,
  follow_up_step integer NOT NULL DEFAULT 0,
  automation_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conversations_lead_idx ON public.conversations (lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- MESSAGES
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  body text NOT NULL,
  provider text,
  provider_message_id text,
  delivery_status text NOT NULL DEFAULT 'queued',
  error_code text,
  message_kind text NOT NULL DEFAULT 'manual',
  idempotency_key text,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_idempotency_idx ON public.messages (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX messages_lead_idx ON public.messages (lead_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SERVICES
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_guidance text,
  included_items text,
  excluded_items text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- JOBS
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_performed text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  completed_value numeric(10,2),
  completion_status text NOT NULL DEFAULT 'scheduled',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- AUTOMATION RULES
CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  rule_type text NOT NULL,
  step integer NOT NULL DEFAULT 1,
  delay_minutes integer NOT NULL DEFAULT 0,
  message_template text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

-- AI OUTPUTS
CREATE TABLE public.ai_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  summary text,
  extracted_fields jsonb,
  missing_fields jsonb,
  readiness text,
  suggested_reply text,
  needs_human_review boolean NOT NULL DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_outputs TO authenticated;
GRANT ALL ON public.ai_outputs TO service_role;
ALTER TABLE public.ai_outputs ENABLE ROW LEVEL SECURITY;

-- AUDIT EVENTS
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- WEBHOOK DEDUPE
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- POLICIES (tenant isolation)
CREATE POLICY "own business" ON public.businesses FOR SELECT TO authenticated USING (id = public.current_business_id());
CREATE POLICY "update own business" ON public.businesses FOR UPDATE TO authenticated USING (id = public.current_business_id()) WITH CHECK (id = public.current_business_id());

CREATE POLICY "profiles in business" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR business_id = public.current_business_id());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "leads tenant" ON public.leads FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "conversations tenant" ON public.conversations FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "messages tenant" ON public.messages FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "services tenant" ON public.services FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "jobs tenant" ON public.jobs FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "rules tenant" ON public.automation_rules FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "ai tenant" ON public.ai_outputs FOR ALL TO authenticated USING (business_id = public.current_business_id()) WITH CHECK (business_id = public.current_business_id());
CREATE POLICY "audit tenant" ON public.audit_events FOR SELECT TO authenticated USING (business_id = public.current_business_id());

-- NEW USER HANDLING: attach to Glocast (single-tenant pilot)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_business uuid;
  member_count integer;
BEGIN
  SELECT id INTO target_business FROM public.businesses ORDER BY created_at LIMIT 1;
  INSERT INTO public.profiles (id, business_id, name, email)
  VALUES (NEW.id, target_business, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), NEW.email);
  SELECT count(*) INTO member_count FROM public.profiles WHERE business_id = target_business;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN member_count <= 1 THEN 'owner'::public.app_role ELSE 'staff'::public.app_role END);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- SEED GLOCAST
INSERT INTO public.businesses (id, name, timezone, phone_number, service_area, opening_hours, sms_signature, privacy_policy_url)
VALUES ('11111111-1111-1111-1111-111111111111', 'Glocast', 'Australia/Sydney', '+61400000000', 'Sydney metro (Inner West, Eastern Suburbs, North Shore)', 'Mon-Sat 7am-6pm', 'Glocast Mobile Detailing', 'https://glocast.example/privacy');

INSERT INTO public.services (business_id, name, description, price_guidance, included_items, excluded_items) VALUES
('11111111-1111-1111-1111-111111111111', 'Express Interior + Exterior', 'Maintenance detail for regularly cleaned vehicles.', '$180 - $250 depending on vehicle size', 'Exterior wash, wheels, interior vacuum, dash and console wipe down', 'Paint correction, pet hair removal, odour treatment'),
('11111111-1111-1111-1111-111111111111', 'Full Interior Detail', 'Deep interior clean including seats and carpets.', '$300 - $420 depending on condition', 'Steam clean, shampoo seats and carpets, plastics, glass, boot', 'Exterior polish, ceramic coating'),
('11111111-1111-1111-1111-111111111111', 'Pet Hair & Odour Treatment', 'Targeted removal of pet hair and odour sources.', '$120 - $220 as an add-on, confirmed after inspection', 'Pet hair extraction, deodorising treatment, fabric agitation', 'Guaranteed removal of permanent staining'),
('11111111-1111-1111-1111-111111111111', 'Paint Enhancement Detail', 'Single-stage machine polish and protection.', '$450 - $650 depending on paint condition', 'Decontamination wash, clay, single stage polish, sealant', 'Multi-stage correction, dent or scratch repair');

INSERT INTO public.automation_rules (business_id, rule_type, step, delay_minutes, message_template) VALUES
('11111111-1111-1111-1111-111111111111', 'acknowledgement', 0, 0, 'Hi {{first_name}}, thanks for contacting {{business_name}}. We''ve received your detailing enquiry. Reply with your vehicle type and main concern so we can help. Reply STOP to opt out.'),
('11111111-1111-1111-1111-111111111111', 'follow_up', 1, 300, 'Hi {{first_name}}, just following up on your detailing enquiry with {{business_name}}. When was the vehicle last thoroughly cleaned, and what are your main concerns? Reply STOP to opt out.'),
('11111111-1111-1111-1111-111111111111', 'follow_up', 2, 1440, 'Hi {{first_name}}, last check-in from {{business_name}}. If you still need your vehicle looked after, reply with the vehicle type and suburb and we''ll point you in the right direction. Reply STOP to opt out.');