CREATE TABLE public.notification_preferences (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  muted_kinds text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification prefs readable in tenant" ON public.notification_preferences
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
CREATE POLICY "notification prefs insertable in tenant" ON public.notification_preferences
  FOR INSERT TO authenticated WITH CHECK (business_id = private.current_business_id());
CREATE POLICY "notification prefs updatable in tenant" ON public.notification_preferences
  FOR UPDATE TO authenticated USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());

CREATE INDEX IF NOT EXISTS notifications_business_unread_idx
  ON public.notifications (business_id) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.push_owner_notification(
  _business_id uuid, _lead_id uuid, _kind text, _title text, _body text, _key text, _metadata jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.notification_preferences p
             WHERE p.business_id = _business_id AND _kind = ANY(p.muted_kinds)) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (business_id, lead_id, kind, title, body, metadata, idempotency_key)
  VALUES (_business_id, _lead_id, _kind, left(_title, 160), left(coalesce(_body, ''), 500), _metadata, _key)
  ON CONFLICT (idempotency_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.push_owner_notification(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  SELECT name INTO _name FROM public.leads WHERE id = NEW.lead_id AND deleted_at IS NULL;
  IF _name IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.direction = 'inbound' THEN
    PERFORM public.push_owner_notification(NEW.business_id, NEW.lead_id, 'customer_reply',
      'Text from ' || _name, NEW.body, 'customer_reply:' || NEW.id);
  ELSIF NEW.direction = 'outbound' AND NEW.delivery_status IN ('failed', 'undelivered')
        AND (TG_OP = 'INSERT' OR OLD.delivery_status IS DISTINCT FROM NEW.delivery_status) THEN
    PERFORM public.push_owner_notification(NEW.business_id, NEW.lead_id, 'sms_failed',
      'Text to ' || _name || ' did not arrive',
      coalesce(NEW.failure_reason, 'The phone network could not deliver it.'), 'sms_failed:' || NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER messages_owner_notifications AFTER INSERT OR UPDATE OF delivery_status ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message();

CREATE OR REPLACE FUNCTION public.notify_on_low_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.credit_balance < 50 AND OLD.credit_balance >= 50 THEN
    PERFORM public.push_owner_notification(NEW.business_id, NULL, 'low_credits',
      'Text credits running low', NEW.credit_balance || ' text credits left. Top up so texts keep sending.',
      'low_credits:' || NEW.business_id || ':' || to_char(now(), 'YYYY-MM-DD'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER texto_accounts_low_credit_notifications AFTER UPDATE OF credit_balance ON public.texto_accounts
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_low_credits();

CREATE OR REPLACE FUNCTION public.notify_on_owner_reminder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.push_owner_notification(NEW.business_id, NULL, 'assistant_change',
    'Booking summary text scheduled', 'Your AI assistant scheduled a booking summary text to your phone.',
    'owner_reminder:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER owner_sms_reminders_notifications AFTER INSERT ON public.owner_sms_reminders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_owner_reminder();

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;