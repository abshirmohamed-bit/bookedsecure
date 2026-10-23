CREATE TABLE public.owner_sms_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 created_by uuid NOT NULL,
 request_key text NOT NULL,
 send_at timestamptz NOT NULL,
 range_start timestamptz NOT NULL,
 range_end timestamptz NOT NULL,
 label text NOT NULL,
 status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','failed','cancelled')),
 parts_sent integer NOT NULL DEFAULT 0,
 provider_message_ids text[] NOT NULL DEFAULT '{}',
 failure_reason text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (range_end > range_start),
 UNIQUE (business_id, request_key)
);
CREATE INDEX owner_sms_reminders_due ON public.owner_sms_reminders(send_at) WHERE status='scheduled';
ALTER TABLE public.owner_sms_reminders ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.owner_sms_reminders TO authenticated;
GRANT ALL ON public.owner_sms_reminders TO service_role;
CREATE POLICY "Owners read their reminders" ON public.owner_sms_reminders FOR SELECT TO authenticated
 USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid() AND p.active));

CREATE OR REPLACE FUNCTION public.schedule_owner_sms_reminder(p_send_at timestamptz, p_range_start timestamptz, p_range_end timestamptz, p_label text, p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; rec public.owner_sms_reminders%ROWTYPE; dest text;
BEGIN
 b:=public.assistant_action_business(true,true);
 IF p_range_end IS NULL OR p_range_start IS NULL OR p_range_end<=p_range_start THEN RAISE EXCEPTION 'The schedule range end must be after its start.'; END IF;
 IF p_range_end-p_range_start > interval '366 days' THEN RAISE EXCEPTION 'Choose a range of at most one year.'; END IF;
 IF p_send_at IS NULL OR p_send_at < now()-interval '5 minutes' THEN RAISE EXCEPTION 'Choose a delivery time that is now or in the future.'; END IF;
 IF length(coalesce(p_request_key,'')) NOT BETWEEN 8 AND 200 OR length(coalesce(p_label,'')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid reminder details.'; END IF;
 SELECT owner_notification_number INTO dest FROM public.businesses WHERE id=b;
 IF dest IS NULL OR dest='' THEN RAISE EXCEPTION 'No owner alert mobile is saved for this business. Add it in Settings first.'; END IF;
 INSERT INTO public.owner_sms_reminders(business_id,created_by,request_key,send_at,range_start,range_end,label)
 VALUES(b,auth.uid(),p_request_key,greatest(p_send_at,now()),p_range_start,p_range_end,p_label)
 ON CONFLICT (business_id,request_key) DO NOTHING RETURNING * INTO rec;
 IF rec.id IS NULL THEN
  SELECT * INTO rec FROM public.owner_sms_reminders WHERE business_id=b AND request_key=p_request_key;
  RETURN jsonb_build_object('reminderId',rec.id,'sendAt',rec.send_at,'status',rec.status,'duplicate',true);
 END IF;
 INSERT INTO public.audit_events(business_id,event_type,entity_type,entity_id,metadata)
 VALUES(b,'owner_sms_reminder_scheduled','business',b,jsonb_build_object('reminder_id',rec.id,'send_at',rec.send_at,'source','connected_assistant'));
 RETURN jsonb_build_object('reminderId',rec.id,'sendAt',rec.send_at,'status',rec.status,'duplicate',false);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_owner_sms_reminder(p_reminder_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid;
BEGIN
 b:=public.assistant_action_business(true,false);
 UPDATE public.owner_sms_reminders SET status='cancelled' WHERE id=p_reminder_id AND business_id=b AND status='scheduled';
 IF NOT FOUND THEN RAISE EXCEPTION 'No pending reminder found in your business.'; END IF;
 RETURN jsonb_build_object('reminderId',p_reminder_id,'status','cancelled');
END $$;

REVOKE ALL ON FUNCTION public.schedule_owner_sms_reminder(timestamptz,timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_owner_sms_reminder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_owner_sms_reminder(timestamptz,timestamptz,timestamptz,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_owner_sms_reminder(uuid) TO authenticated;