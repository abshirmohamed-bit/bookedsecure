-- Email campaigns: one optional follow-up per campaign (Explee-style sequence),
-- scheduled sending, and per-recipient follow-up tracking. Follow-ups are sent
-- by the existing 10-minute follow-ups hook, only to customers who received the
-- first email, have not unsubscribed and (by default) have not booked since.

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS follow_up_subject text,
  ADD COLUMN IF NOT EXISTS follow_up_body text,
  ADD COLUMN IF NOT EXISTS follow_up_delay_days integer,
  ADD COLUMN IF NOT EXISTS stop_on_booking boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS audience_label text;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_follow_up_delay_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_follow_up_delay_check
  CHECK (follow_up_delay_days IS NULL OR follow_up_delay_days BETWEEN 1 AND 30);

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS follow_up_status text,
  ADD COLUMN IF NOT EXISTS follow_up_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_error text;

CREATE INDEX IF NOT EXISTS email_campaigns_scheduled_idx
  ON public.email_campaigns (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS email_campaign_recipients_follow_up_idx
  ON public.email_campaign_recipients (sent_at)
  WHERE follow_up_status = 'pending';
