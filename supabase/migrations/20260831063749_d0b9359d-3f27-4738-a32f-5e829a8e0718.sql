ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider_raw_status text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failure_class text,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_event_id text,
  ADD COLUMN IF NOT EXISTS delivery_event_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS automation_stopped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message_source text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_outbound_sms_status text,
  ADD COLUMN IF NOT EXISTS last_outbound_sms_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivered_sms_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sms_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sms_failure_reason text,
  ADD COLUMN IF NOT EXISTS last_sms_failure_code text,
  ADD COLUMN IF NOT EXISTS sms_suppressed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_suppression_reason text,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_business_provider_message_idx
  ON public.messages (business_id, provider_message_id);