-- Facebook & Instagram DMs and the sync state for comments/DMs.
-- Server-only (RLS on, no client policies): owner-checked server functions read them.
CREATE TABLE IF NOT EXISTS public.social_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram')),
  thread_id text NOT NULL,
  participant_id text NOT NULL,
  participant_name text,
  message_id text,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','sent','failed')),
  error text,
  sent_by uuid,
  draft_reply text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, platform, message_id)
);
CREATE INDEX IF NOT EXISTS social_messages_thread_idx ON public.social_messages (business_id, platform, participant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS social_messages_recent_idx ON public.social_messages (business_id, sent_at DESC);
GRANT ALL ON public.social_messages TO service_role;
ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_on_social_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'in' THEN
    PERFORM public.push_owner_notification(NEW.business_id, NULL, 'social_message',
      'New ' || initcap(NEW.platform) || ' message',
      coalesce(NEW.participant_name || ': ', '') || left(NEW.body, 200),
      'social_message:' || NEW.id::text,
      jsonb_build_object('social_message_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS social_messages_notify ON public.social_messages;
CREATE TRIGGER social_messages_notify AFTER INSERT ON public.social_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_social_message();

CREATE TABLE IF NOT EXISTS public.meta_social_state (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  ig_user_id text,
  ig_username text,
  comments_synced_at timestamptz,
  messages_synced_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.meta_social_state TO service_role;
ALTER TABLE public.meta_social_state ENABLE ROW LEVEL SECURITY;