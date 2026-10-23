CREATE OR REPLACE FUNCTION public.cancel_owner_sms_reminder(p_reminder_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid;
BEGIN
 b:=public.assistant_action_business(false,true);
 UPDATE public.owner_sms_reminders SET status='cancelled' WHERE id=p_reminder_id AND business_id=b AND status='scheduled';
 IF NOT FOUND THEN RAISE EXCEPTION 'No pending reminder found in your business.'; END IF;
 RETURN jsonb_build_object('reminderId',p_reminder_id,'status','cancelled');
END $$;