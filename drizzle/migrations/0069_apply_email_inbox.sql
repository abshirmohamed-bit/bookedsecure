CREATE TABLE IF NOT EXISTS public.email_mailboxes (
  business_id uuid PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  local_part text NOT NULL UNIQUE CHECK (local_part ~ '^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$'),
  display_name text,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT '',
  participants text[] NOT NULL DEFAULT '{}',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_snippet text NOT NULL DEFAULT '',
  last_direction text NOT NULL DEFAULT 'in' CHECK (last_direction IN ('in', 'out')),
  last_from text,
  message_count integer NOT NULL DEFAULT 0,
  unread_count integer NOT NULL DEFAULT 0,
  has_inbound boolean NOT NULL DEFAULT false,
  has_outbound boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_threads_business_idx ON public.email_threads (business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS email_threads_lead_idx ON public.email_threads (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.email_threads (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS to_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bcc_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS references_header text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON public.email_messages (thread_id, created_at) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_message_id_idx ON public.email_messages (business_id, message_id) WHERE message_id IS NOT NULL;

GRANT SELECT ON public.email_mailboxes, public.email_threads TO authenticated;
GRANT ALL ON public.email_mailboxes, public.email_threads TO service_role;
ALTER TABLE public.email_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email mailbox readable in tenant" ON public.email_mailboxes;
CREATE POLICY "email mailbox readable in tenant" ON public.email_mailboxes
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
DROP POLICY IF EXISTS "email threads readable in tenant" ON public.email_threads;
CREATE POLICY "email threads readable in tenant" ON public.email_threads
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

CREATE OR REPLACE FUNCTION public.notify_on_email_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'in' THEN
    PERFORM public.push_owner_notification(NEW.business_id, NEW.lead_id, 'email_reply',
      'Email from ' || COALESCE(NULLIF(NEW.from_name, ''), NEW.from_email),
      left(COALESCE(NULLIF(NEW.subject, '') || ': ', '') || NEW.body_text, 200),
      'email_reply:' || NEW.id::text,
      jsonb_build_object('email_message_id', NEW.id, 'campaign_id', NEW.campaign_id, 'recipient_id', NEW.recipient_id, 'thread_id', NEW.thread_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;