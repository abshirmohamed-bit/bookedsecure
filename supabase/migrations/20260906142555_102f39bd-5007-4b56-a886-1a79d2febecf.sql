CREATE TABLE public.reactivation_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  offer_text text NOT NULL,
  offer_source text NOT NULL DEFAULT 'ai_proposed' CHECK (offer_source IN ('ai_proposed','owner_edited')),
  ai_notes text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  attested_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reactivation_campaigns TO authenticated;
GRANT ALL ON public.reactivation_campaigns TO service_role;
ALTER TABLE public.reactivation_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactivation campaigns readable in tenant" ON public.reactivation_campaigns
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE TABLE public.reactivation_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.reactivation_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  body text NOT NULL,
  edited boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','skipped','sent','failed')),
  send_reason text,
  message_id uuid REFERENCES public.messages(id),
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);

GRANT SELECT ON public.reactivation_drafts TO authenticated;
GRANT ALL ON public.reactivation_drafts TO service_role;
ALTER TABLE public.reactivation_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactivation drafts readable in tenant" ON public.reactivation_drafts
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE INDEX reactivation_campaigns_business_status_idx ON public.reactivation_campaigns (business_id, status, created_at DESC);
CREATE INDEX reactivation_drafts_campaign_idx ON public.reactivation_drafts (campaign_id);

CREATE TRIGGER reactivation_campaigns_updated_at BEFORE UPDATE ON public.reactivation_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER reactivation_drafts_updated_at BEFORE UPDATE ON public.reactivation_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();