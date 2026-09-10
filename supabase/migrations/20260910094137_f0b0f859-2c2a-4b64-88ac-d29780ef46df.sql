CREATE TABLE public.quote_page_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug text,
  session_key text,
  conversation_id uuid REFERENCES public.web_conversations(id) ON DELETE SET NULL,
  source text,
  campaign text,
  medium text,
  referrer text,
  landing_url text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.quote_page_events TO authenticated;
GRANT ALL ON public.quote_page_events TO service_role;

ALTER TABLE public.quote_page_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their business quote page events"
ON public.quote_page_events
FOR SELECT
TO authenticated
USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE INDEX quote_page_events_business_created_idx
  ON public.quote_page_events (business_id, created_at DESC);
CREATE INDEX quote_page_events_session_idx
  ON public.quote_page_events (business_id, session_key);

ALTER TABLE public.web_conversations
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN abandoned_at timestamptz,
  ADD COLUMN mobile_captured_at timestamptz;

UPDATE public.web_conversations SET last_activity_at = updated_at;

CREATE INDEX web_conversations_business_activity_idx
  ON public.web_conversations (business_id, last_activity_at DESC);

CREATE OR REPLACE FUNCTION public.web_conversation_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_activity_at = now();
  IF NEW.mobile_captured_at IS NULL
     AND COALESCE(NULLIF(TRIM(NEW.collected->>'mobile_number'), ''), NULL) IS NOT NULL THEN
    NEW.mobile_captured_at = now();
  END IF;
  IF NEW.status = 'abandoned' AND NEW.abandoned_at IS NULL THEN
    NEW.abandoned_at = now();
  END IF;
  IF NEW.status <> 'abandoned' THEN
    NEW.abandoned_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER web_conversations_activity
BEFORE INSERT OR UPDATE ON public.web_conversations
FOR EACH ROW EXECUTE FUNCTION public.web_conversation_activity();

CREATE OR REPLACE FUNCTION public.sweep_abandoned_web_conversations(p_minutes integer DEFAULT 1440)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  swept integer;
BEGIN
  WITH stale AS (
    UPDATE public.web_conversations
       SET status = 'abandoned'
     WHERE status = 'active'
       AND last_activity_at < now() - make_interval(mins => p_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO swept FROM stale;
  RETURN COALESCE(swept, 0);
END;
$$;