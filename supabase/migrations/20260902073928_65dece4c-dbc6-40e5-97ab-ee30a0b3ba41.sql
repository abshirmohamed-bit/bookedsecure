ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS quote_mode text NOT NULL DEFAULT 'manual_sms';

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_quote_mode_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_quote_mode_check CHECK (quote_mode IN ('manual_sms', 'ai_chat'));

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_origin_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_origin_check CHECK (
  lead_origin IS NULL OR lead_origin = ANY (ARRAY['live','historical','reactivation','crm_import','inbound_form','ai_web_chat'])
);

CREATE TABLE public.web_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  consent_outcome text,
  unsupported_request text,
  requires_owner_review boolean NOT NULL DEFAULT false,
  selected_service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name_snapshot text,
  collected jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT web_conversations_status_check CHECK (status IN ('active','completed','abandoned','declined')),
  CONSTRAINT web_conversations_consent_check CHECK (consent_outcome IS NULL OR consent_outcome IN ('granted','declined'))
);

GRANT SELECT ON public.web_conversations TO authenticated;
GRANT ALL ON public.web_conversations TO service_role;
ALTER TABLE public.web_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their business web conversations"
  ON public.web_conversations FOR SELECT TO authenticated
  USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE TABLE public.web_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.web_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT web_conversation_messages_role_check CHECK (role IN ('customer','assistant','system'))
);

GRANT SELECT ON public.web_conversation_messages TO authenticated;
GRANT ALL ON public.web_conversation_messages TO service_role;
ALTER TABLE public.web_conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their business web conversation messages"
  ON public.web_conversation_messages FOR SELECT TO authenticated
  USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE INDEX web_conversations_business_created_idx ON public.web_conversations (business_id, created_at DESC);
CREATE INDEX web_conversations_lead_idx ON public.web_conversations (lead_id);
CREATE INDEX web_conversation_messages_conversation_idx ON public.web_conversation_messages (conversation_id, created_at);

CREATE TRIGGER web_conversations_updated BEFORE UPDATE ON public.web_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();