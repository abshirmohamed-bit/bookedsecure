-- Customer replies to campaign emails, and the owner's answers, kept as one
-- conversation per campaign recipient. Inbound replies arrive through the
-- Resend inbound webhook (reply+<recipient id>@reply.bookedsecure.com);
-- the table is written only by the server, and tenants can read their own rows.

CREATE TABLE IF NOT EXISTS public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.email_campaigns (id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES public.email_campaign_recipients (id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  from_email text NOT NULL,
  from_name text,
  to_email text NOT NULL,
  subject text,
  body_text text NOT NULL DEFAULT '',
  message_id text,
  in_reply_to text,
  provider_id text UNIQUE,
  status text NOT NULL DEFAULT 'received',
  error text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_messages_business_idx ON public.email_messages (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_recipient_idx ON public.email_messages (recipient_id, created_at);
CREATE INDEX IF NOT EXISTS email_messages_unread_idx ON public.email_messages (business_id) WHERE direction = 'in' AND read_at IS NULL;

GRANT SELECT ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email messages readable in tenant" ON public.email_messages;
CREATE POLICY "email messages readable in tenant" ON public.email_messages
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

-- Owner alert for every customer reply (honours notification mutes).
CREATE OR REPLACE FUNCTION public.notify_on_email_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'in' THEN
    PERFORM public.push_owner_notification(NEW.business_id, NEW.lead_id, 'email_reply',
      'Email from ' || COALESCE(NULLIF(NEW.from_name, ''), NEW.from_email),
      left(NEW.body_text, 200),
      'email_reply:' || NEW.id::text,
      jsonb_build_object('email_message_id', NEW.id, 'campaign_id', NEW.campaign_id, 'recipient_id', NEW.recipient_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS email_messages_notify ON public.email_messages;
CREATE TRIGGER email_messages_notify AFTER INSERT ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_email_reply();
