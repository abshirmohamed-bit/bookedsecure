CREATE OR REPLACE FUNCTION public.assistant_operational_action(p_action text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; r uuid; l uuid; n integer:=0; j public.jobs%ROWTYPE; c public.conversations%ROWTYPE; patch jsonb; overrides jsonb; start_at timestamptz;
BEGIN
 b:=public.assistant_action_business(true,true);
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'Action details are required.'; END IF;
 IF p_action='update_customer' THEN
  IF p_input - ARRAY['leadId','name','mobile','email','suburb','address','vehicle','requestedService','notes','status','clearOptOut']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported customer fields.'; END IF;
  r:=(p_input->>'leadId')::uuid;
  PERFORM id FROM public.leads WHERE id=r AND business_id=b AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found in your business.'; END IF;
  IF p_input->>'mobile' IS NOT NULL AND p_input->>'mobile' !~ '^\+614[0-9]{8}$' THEN RAISE EXCEPTION 'Invalid Australian mobile.'; END IF;
  IF length(COALESCE(p_input->>'notes',''))>5000 THEN RAISE EXCEPTION 'Notes are too long.'; END IF;
  IF p_input->>'status' IS NOT NULL AND p_input->>'status' NOT IN ('new','contacted','waiting_for_customer','replied','quote_ready','quote_sent','scheduled','completed','lost','opted_out','invalid') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  UPDATE public.leads SET name=COALESCE(p_input->>'name',name),mobile_number=COALESCE(p_input->>'mobile',mobile_number),email=COALESCE(p_input->>'email',email),suburb=COALESCE(p_input->>'suburb',suburb),service_address=COALESCE(p_input->>'address',service_address),vehicle_type=COALESCE(p_input->>'vehicle',vehicle_type),service_intent=COALESCE(p_input->>'requestedService',service_intent),notes=COALESCE(p_input->>'notes',notes),status=COALESCE(p_input->>'status',status),opted_out_at=CASE WHEN p_input->>'status'='opted_out' THEN now() WHEN (p_input->>'clearOptOut')::boolean=true THEN NULL ELSE opted_out_at END,consent_status=CASE WHEN p_input->>'status'='opted_out' THEN 'opted_out' WHEN (p_input->>'clearOptOut')::boolean=true THEN 'granted' ELSE consent_status END WHERE id=r AND business_id=b;
 ELSIF p_action IN ('book_job','reschedule_job','cancel_job','delete_job','complete_job') THEN
  IF p_input - ARRAY['leadId','jobId','date','time','startsAt','serviceName','notes','reason','paidAmount']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported booking fields.'; END IF;
  r:=(p_input->>'jobId')::uuid; l:=(p_input->>'leadId')::uuid;
  IF r IS NOT NULL THEN SELECT * INTO j FROM public.jobs WHERE id=r AND business_id=b FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found in your business.'; END IF; IF l IS NOT NULL AND l<>j.lead_id THEN RAISE EXCEPTION 'That booking belongs to a different customer.'; END IF; l:=j.lead_id; END IF;
  PERFORM id FROM public.leads WHERE id=l AND business_id=b AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found in your business.'; END IF;
  IF p_action IN ('book_job','reschedule_job') THEN
   start_at:=(p_input->>'startsAt')::timestamptz;
   IF start_at IS NULL OR start_at<=now() THEN RAISE EXCEPTION 'Choose a future booking time.'; END IF;
   IF p_action='book_job' THEN r:=public.schedule_owner_job(b,l,start_at); UPDATE public.jobs SET service_performed=COALESCE(p_input->>'serviceName',service_performed),notes=COALESCE(p_input->>'notes',notes) WHERE id=r AND business_id=b;
   ELSE IF r IS NULL THEN RAISE EXCEPTION 'A booking is required.'; END IF; UPDATE public.jobs SET scheduled_at=start_at,completion_status='scheduled' WHERE id=r AND business_id=b; UPDATE public.leads SET status='scheduled',booking_status='scheduled' WHERE id=l AND business_id=b; END IF;
  ELSIF p_action='complete_job' THEN
   IF p_input->>'paidAmount' IS NOT NULL AND ((p_input->>'paidAmount')::numeric<=0 OR (p_input->>'paidAmount')::numeric>1000000) THEN RAISE EXCEPTION 'Invalid paid amount.'; END IF;
   IF r IS NULL THEN SELECT id INTO r FROM public.jobs WHERE business_id=b AND lead_id=l AND completion_status<>'cancelled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE; END IF;
   IF r IS NULL THEN INSERT INTO public.jobs(business_id,lead_id,scheduled_at,completion_status) VALUES(b,l,now(),'completed') RETURNING id INTO r; END IF;
   UPDATE public.jobs SET completion_status='completed',completed_at=now(),completed_value=COALESCE((p_input->>'paidAmount')::numeric,completed_value),service_performed=COALESCE(p_input->>'serviceName',service_performed) WHERE id=r AND business_id=b;
   UPDATE public.leads SET status='completed',booking_status='completed',customer_status='previous_customer' WHERE id=l AND business_id=b;
  ELSIF p_action='cancel_job' THEN
   IF r IS NULL THEN RAISE EXCEPTION 'A booking is required.'; END IF;
   UPDATE public.jobs SET completion_status='cancelled',completed_at=NULL,completed_value=NULL,notes=COALESCE(p_input->>'reason',notes) WHERE id=r AND business_id=b;
   UPDATE public.leads SET booking_status='cancelled' WHERE id=l AND business_id=b;
  ELSE
   IF r IS NULL THEN RAISE EXCEPTION 'A booking is required.'; END IF;
   UPDATE public.booking_offers SET job_id=NULL,status='withdrawn' WHERE business_id=b AND job_id=r;
   DELETE FROM public.jobs WHERE id=r AND business_id=b;
   UPDATE public.leads SET booking_status=CASE WHEN EXISTS(SELECT 1 FROM public.jobs WHERE business_id=b AND lead_id=l AND completion_status='scheduled') THEN 'scheduled' WHEN EXISTS(SELECT 1 FROM public.jobs WHERE business_id=b AND lead_id=l AND completion_status='completed') THEN 'completed' ELSE 'none' END,status=CASE WHEN status IN ('scheduled','completed') AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE business_id=b AND lead_id=l AND completion_status IN ('scheduled','completed')) THEN 'contacted' ELSE status END WHERE id=l AND business_id=b;
  END IF;
 ELSIF p_action='set_addon_availability' THEN
  IF p_input - ARRAY['addonId','serviceIds','remove']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported add-on fields.'; END IF;
  r:=(p_input->>'addonId')::uuid;
  PERFORM id FROM public.service_addons WHERE id=r AND business_id=b FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Extra not found in your business.'; END IF;
  IF jsonb_array_length(p_input->'serviceIds') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose 1 to 200 services.'; END IF;
  FOR l IN SELECT value::uuid FROM jsonb_array_elements_text(p_input->'serviceIds') LOOP
   PERFORM id FROM public.services WHERE id=l AND business_id=b; IF NOT FOUND THEN RAISE EXCEPTION 'Service not found in your business.'; END IF;
   IF (p_input->>'remove')::boolean THEN DELETE FROM public.service_addon_links WHERE addon_id=r AND service_id=l; ELSE INSERT INTO public.service_addon_links(service_id,addon_id) VALUES(l,r) ON CONFLICT DO NOTHING; END IF; n:=n+1;
  END LOOP;
 ELSIF p_action IN ('set_quote_page_mode','set_sending_paused') THEN
  r:=b;
  IF p_action='set_quote_page_mode' THEN IF p_input - ARRAY['mode']::text[] <> '{}'::jsonb OR p_input->>'mode' NOT IN ('manual_sms','ai_chat') THEN RAISE EXCEPTION 'Invalid quote mode.'; END IF; UPDATE public.businesses SET quote_mode=p_input->>'mode' WHERE id=b;
  ELSE IF p_input - ARRAY['paused']::text[] <> '{}'::jsonb OR jsonb_typeof(p_input->'paused')<>'boolean' THEN RAISE EXCEPTION 'Pause state is required.'; END IF; UPDATE public.businesses SET automation_enabled=NOT (p_input->>'paused')::boolean WHERE id=b; END IF;
 ELSIF p_action='update_follow_up_rule' THEN
  IF p_input - ARRAY['ruleId','delayMinutes','messageTemplate','active']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported rule fields.'; END IF;
  r:=(p_input->>'ruleId')::uuid;
  IF (p_input->>'delayMinutes')::integer NOT BETWEEN 0 AND 20160 OR length(p_input->>'messageTemplate') NOT BETWEEN 10 AND 600 THEN RAISE EXCEPTION 'Invalid follow-up wording or delay.'; END IF;
  UPDATE public.automation_rules SET delay_minutes=COALESCE((p_input->>'delayMinutes')::integer,delay_minutes),message_template=COALESCE(p_input->>'messageTemplate',message_template),active=COALESCE((p_input->>'active')::boolean,active) WHERE id=r AND business_id=b;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up rule not found in your business.'; END IF;
 ELSIF p_action IN ('set_customer_follow_ups','customise_customer_follow_up') THEN
  IF p_input - ARRAY['leadId','paused','step','messageTemplate','delayMinutes','reset']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported follow-up fields.'; END IF;
  r:=(p_input->>'leadId')::uuid;
  PERFORM id FROM public.leads WHERE id=r AND business_id=b AND deleted_at IS NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found in your business.'; END IF;
  SELECT * INTO c FROM public.conversations WHERE lead_id=r AND business_id=b FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'This customer has no follow-up sequence.'; END IF;
  IF p_action='set_customer_follow_ups' THEN UPDATE public.conversations SET automation_paused=(p_input->>'paused')::boolean,next_follow_up_at=CASE WHEN (p_input->>'paused')::boolean THEN NULL ELSE now()+interval '1 hour' END WHERE id=c.id AND business_id=b;
  ELSE
   n:=(p_input->>'step')::integer;
   IF n NOT BETWEEN 1 AND 20 OR (p_input->>'delayMinutes')::integer NOT BETWEEN 0 AND 10080 OR length(p_input->>'messageTemplate')>600 THEN RAISE EXCEPTION 'Invalid follow-up step.'; END IF;
   PERFORM id FROM public.automation_rules WHERE business_id=b AND rule_type='follow_up' AND step=n; IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up step not found.'; END IF;
   overrides:=COALESCE(c.follow_up_overrides,'{}'::jsonb);
   IF (p_input->>'reset')::boolean THEN overrides:=overrides-n::text;
   ELSE patch:=jsonb_strip_nulls(jsonb_build_object('delay_minutes',(p_input->>'delayMinutes')::integer,'message_template',p_input->>'messageTemplate')); overrides:=jsonb_set(overrides,ARRAY[n::text],COALESCE(overrides->n::text,'{}'::jsonb)||patch,true); END IF;
   UPDATE public.conversations SET follow_up_overrides=overrides WHERE id=c.id AND business_id=b;
  END IF;
 ELSIF p_action='bulk_update_lead_status' THEN
  IF p_input - ARRAY['toStatus','fromStatuses','source','origin','excludeOptedOut']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported status fields.'; END IF;
  IF p_input->>'toStatus' NOT IN ('new','contacted','waiting_for_customer','replied','quote_ready','quote_sent','scheduled','completed','lost','opted_out','invalid') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  WITH targets AS (SELECT id FROM public.leads WHERE business_id=b AND deleted_at IS NULL AND status<>p_input->>'toStatus' AND (p_input->'fromStatuses'='null'::jsonb OR p_input->'fromStatuses' IS NULL OR status IN (SELECT jsonb_array_elements_text(p_input->'fromStatuses'))) AND (p_input->>'source' IS NULL OR p_input->>'source'='any' OR source_channel=p_input->>'source') AND (p_input->>'origin' IS NULL OR p_input->>'origin'='any' OR lead_origin=p_input->>'origin') AND ((p_input->>'excludeOptedOut')::boolean=false OR (opted_out_at IS NULL AND status<>'opted_out')) ORDER BY id LIMIT 5000 FOR UPDATE) UPDATE public.leads SET status=p_input->>'toStatus' WHERE business_id=b AND id IN (SELECT id FROM targets);
  GET DIAGNOSTICS n=ROW_COUNT; r:=b;
 ELSE RAISE EXCEPTION 'This assistant action is not enabled.';
 END IF;
 INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(b,auth.uid(),'assistant_'||p_action,'business',r,jsonb_build_object('action',p_action,'client_id',auth.jwt()->>'client_id','changed',n));
 RETURN jsonb_build_object('ok',true,'id',r,'updated',n,'changed',n);
END; $$;
REVOKE ALL ON FUNCTION public.assistant_operational_action(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_operational_action(text,jsonb) TO authenticated;