ALTER TABLE public.sequence_campaigns
  ADD COLUMN IF NOT EXISTS message_path text,
  ADD COLUMN IF NOT EXISTS lead_context text,
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS max_sends integer,
  ADD COLUMN IF NOT EXISTS max_recipients integer,
  ADD COLUMN IF NOT EXISTS max_segments integer;

UPDATE public.sequence_campaigns
SET status = 'disabled',
    disabled_at = now(),
    disabled_reason = 'Revoked unused: obsolete sequence_follow_up path and contact_only_introduction_neutral template. Zero messages, zero agent_actions, zero provider calls.',
    execution_authorised_at = NULL,
    execution_authorisation_kind = NULL,
    updated_at = now()
WHERE id = 'b042997b-b7b3-4020-84f6-280be23caa2c'
  AND business_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.sequence_campaigns (
  business_id, name, sequence_id, template_id, template_version, message_path, lead_context,
  status, scope_kind, scope_lead_ids, max_leads, max_sends, max_recipients, max_segments,
  sequence_approved_at, campaign_approved_at, execution_authorised_at, execution_authorisation_kind
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Canary — single lead active enquiry qualification (Abshir)',
  'active_enquiry_qualification',
  'active_enquiry_qualification_step',
  1,
  'new_lead_response',
  'active_form_enquiry',
  'authorised',
  'explicit_lead_ids',
  ARRAY['cd1efc35-f955-4f96-a1ba-b641220c94b6']::uuid[],
  1, 1, 1, 1,
  now(), now(), now(), 'canary'
);