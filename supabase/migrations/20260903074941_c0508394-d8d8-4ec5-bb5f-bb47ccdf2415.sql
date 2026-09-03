-- 1. Agent action ledger
CREATE TABLE public.agent_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  sequence_id text NOT NULL,
  action_kind text NOT NULL,
  template_id text,
  idempotency_key text NOT NULL,
  mode text NOT NULL DEFAULT 'dry_run',
  status text NOT NULL DEFAULT 'planned',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  blocked_reason text,
  failure_reason text,
  scheduled_for timestamp with time zone,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  result_ref uuid,
  result_kind text,
  plan_snapshot jsonb,
  campaign_id uuid,
  activation_id uuid,
  rolled_back_at timestamp with time zone,
  rollback_reason text,
  rollback_actor uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_actions_mode_check CHECK (mode IN ('dry_run', 'live')),
  CONSTRAINT agent_actions_status_check CHECK (status IN ('planned', 'claimed', 'succeeded', 'blocked', 'failed', 'abandoned', 'rolled_back')),
  CONSTRAINT agent_actions_kind_check CHECK (action_kind IN ('capture_consent', 'send_message', 'schedule_follow_up', 'offer_booking', 'handoff', 'record_audit', 'no_action')),
  CONSTRAINT agent_actions_result_kind_check CHECK (result_kind IS NULL OR result_kind IN ('message', 'job', 'booking_offer', 'notification', 'audit_event'))
);

CREATE UNIQUE INDEX agent_actions_tenant_idempotency_key
  ON public.agent_actions (business_id, mode, idempotency_key);
CREATE INDEX agent_actions_lead_idx ON public.agent_actions (business_id, lead_id, created_at DESC);
CREATE INDEX agent_actions_claimable_idx ON public.agent_actions (mode, status, scheduled_for);

GRANT SELECT ON public.agent_actions TO authenticated;
GRANT ALL ON public.agent_actions TO service_role;
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent actions readable in tenant" ON public.agent_actions
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE TRIGGER agent_actions_updated BEFORE UPDATE ON public.agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Sequence campaigns (approval + explicit scope)
CREATE TABLE public.sequence_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence_id text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  scope_kind text NOT NULL DEFAULT 'explicit_lead_ids',
  scope_lead_ids uuid[] NOT NULL DEFAULT '{}',
  max_leads integer NOT NULL DEFAULT 1,
  sequence_approved_at timestamp with time zone,
  sequence_approved_by uuid,
  campaign_approved_at timestamp with time zone,
  campaign_approved_by uuid,
  execution_authorised_at timestamp with time zone,
  execution_authorised_by uuid,
  execution_authorisation_kind text,
  disabled_at timestamp with time zone,
  disabled_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sequence_campaigns_status_check CHECK (status IN ('draft', 'approved', 'authorised', 'running', 'completed', 'disabled', 'rolled_back')),
  CONSTRAINT sequence_campaigns_scope_check CHECK (scope_kind = 'explicit_lead_ids'),
  CONSTRAINT sequence_campaigns_auth_kind_check CHECK (execution_authorisation_kind IS NULL OR execution_authorisation_kind IN ('canary', 'bounded_batch'))
);

CREATE INDEX sequence_campaigns_business_idx ON public.sequence_campaigns (business_id, created_at DESC);

GRANT SELECT ON public.sequence_campaigns TO authenticated;
GRANT ALL ON public.sequence_campaigns TO service_role;
ALTER TABLE public.sequence_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sequence campaigns readable in tenant" ON public.sequence_campaigns
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE TRIGGER sequence_campaigns_updated BEFORE UPDATE ON public.sequence_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_campaign_fk FOREIGN KEY (campaign_id)
  REFERENCES public.sequence_campaigns(id) ON DELETE SET NULL;

-- 3. Tenant activation gates (all default off)
ALTER TABLE public.businesses
  ADD COLUMN agent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN agent_execution_opted_in_at timestamp with time zone,
  ADD COLUMN agent_execution_opted_in_by uuid,
  ADD COLUMN agent_kill_switch_at timestamp with time zone,
  ADD COLUMN agent_kill_switch_by uuid,
  ADD COLUMN agent_kill_switch_reason text,
  ADD COLUMN agent_daily_send_cap integer NOT NULL DEFAULT 0,
  ADD COLUMN agent_hourly_send_cap integer NOT NULL DEFAULT 0,
  ADD COLUMN agent_max_leads_per_activation integer NOT NULL DEFAULT 1;

-- 4. Global kill switch
ALTER TABLE public.commercial_config
  ADD COLUMN agent_global_kill_switch_at timestamp with time zone,
  ADD COLUMN agent_global_kill_switch_reason text;

-- 5. Attribution on messages and jobs
ALTER TABLE public.messages
  ADD COLUMN sequence_id text,
  ADD COLUMN agent_action_id uuid REFERENCES public.agent_actions(id) ON DELETE SET NULL,
  ADD COLUMN template_id text;

ALTER TABLE public.automation_jobs
  ADD COLUMN sequence_id text,
  ADD COLUMN agent_action_id uuid REFERENCES public.agent_actions(id) ON DELETE SET NULL,
  ADD COLUMN sequence_step_template_id text;

-- 6. Booking confirmation delivery state (exactly once per confirmed booking)
ALTER TABLE public.booking_offers
  ADD COLUMN confirmation_sms_sent_at timestamp with time zone,
  ADD COLUMN confirmation_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;