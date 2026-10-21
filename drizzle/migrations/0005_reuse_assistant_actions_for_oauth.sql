CREATE OR REPLACE FUNCTION public.assistant_action_business(p_require_plan boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; s text; e timestamptz; d timestamptz; a boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to use assistant actions.'; END IF;
 SELECT business_id INTO b FROM public.profiles WHERE id=auth.uid() AND active=true;
 IF b IS NULL THEN RAISE EXCEPTION 'An active business account is required.'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='platform_admin') INTO a;
 IF NOT a AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner') THEN RAISE EXCEPTION 'Only the business owner can change data through this connection.'; END IF;
 SELECT subscription_status,current_period_end,past_due_since INTO s,e,d FROM public.businesses WHERE id=b;
 IF p_require_plan AND NOT a AND NOT COALESCE(s='active' OR (s IN ('trialing','canceled') AND e>now()) OR (s='past_due' AND (d IS NULL OR d+interval '7 days'>now())),false) THEN RAISE EXCEPTION 'Your trial or subscription has ended. Contact BookedSecure to restore write access.'; END IF;
 RETURN b;
END; $$;
REVOKE ALL ON FUNCTION public.assistant_action_business(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_action_business(boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.assistant_account_action(p_action text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; r uuid; n text; t text; patch jsonb; duration integer;
BEGIN
 b:=public.assistant_action_business();
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'Action details are required.'; END IF;
 IF p_action='create_customer' THEN
  IF p_input - ARRAY['name','mobile','email','suburb','address','vehicle','requestedService','notes']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported customer fields.'; END IF;
  n:=nullif(btrim(p_input->>'name'),'');
  IF n IS NULL OR length(n)>200 OR COALESCE(p_input->>'mobile','') !~ '^\+614[0-9]{8}$' OR length(COALESCE(p_input->>'notes',''))>5000 THEN RAISE EXCEPTION 'Provide a name and valid Australian mobile number.'; END IF;
  INSERT INTO public.leads(business_id,name,mobile_number,email,suburb,service_address,vehicle_type,service_intent,notes,lead_context,manual_entry_by)
  VALUES(b,n,p_input->>'mobile',p_input->>'email',p_input->>'suburb',p_input->>'address',p_input->>'vehicle',p_input->>'requestedService',p_input->>'notes','manually_added_contact',auth.uid()) RETURNING id INTO r;
 ELSIF p_action IN ('upsert_service','upsert_addon') THEN
  IF p_input - ARRAY['serviceId','addonId','name','price','durationMinutes','category','description','active']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported catalog fields.'; END IF;
  t:=CASE WHEN p_action='upsert_service' THEN 'services' ELSE 'service_addons' END;
  r:=nullif(p_input->>CASE WHEN p_action='upsert_service' THEN 'serviceId' ELSE 'addonId' END,'')::uuid;
  n:=nullif(btrim(p_input->>'name'),''); duration:=(p_input->>'durationMinutes')::integer;
  IF (n IS NOT NULL AND length(n)>200) OR (duration IS NOT NULL AND (duration<5 OR duration>1440)) OR length(COALESCE(p_input->>'description',''))>5000 THEN RAISE EXCEPTION 'Invalid catalog details.'; END IF;
  patch:=jsonb_strip_nulls(jsonb_build_object('name',n,'price_guidance',p_input->>'price','duration_minutes',duration,'category',p_input->>'category','description',p_input->>'description','active',(p_input->>'active')::boolean));
  IF r IS NULL THEN
   IF n IS NULL THEN RAISE EXCEPTION 'A new service or extra needs a name.'; END IF;
   EXECUTE format('INSERT INTO public.%I (business_id,name,price_guidance,duration_minutes,category,description,active) VALUES($1,$2,$3,COALESCE($4,60),COALESCE($5,''General''),$6,COALESCE($7,true)) RETURNING id,name',t) INTO r,n USING b,n,p_input->>'price',duration,p_input->>'category',p_input->>'description',(p_input->>'active')::boolean;
  ELSE
   IF patch='{}'::jsonb THEN RAISE EXCEPTION 'Nothing was named to change.'; END IF;
   EXECUTE format('UPDATE public.%I SET name=COALESCE($3->>''name'',name),price_guidance=COALESCE($3->>''price_guidance'',price_guidance),duration_minutes=COALESCE(($3->>''duration_minutes'')::integer,duration_minutes),category=COALESCE($3->>''category'',category),description=COALESCE($3->>''description'',description),active=COALESCE(($3->>''active'')::boolean,active) WHERE id=$1 AND business_id=$2 RETURNING id,name',t) INTO r,n USING r,b,patch;
   IF r IS NULL THEN RAISE EXCEPTION 'That service or extra does not belong to your business.'; END IF;
  END IF;
 ELSIF p_action='update_business_settings' THEN
  patch:=jsonb_strip_nulls(p_input);
  IF patch - ARRAY['name','phone_number','service_area','opening_hours','sms_signature','privacy_policy_url','timezone','quiet_hours_start','quiet_hours_end']::text[] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported business settings.'; END IF;
  IF patch='{}'::jsonb THEN RAISE EXCEPTION 'Nothing to change.'; END IF;
  IF patch ? 'timezone' AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=patch->>'timezone') THEN RAISE EXCEPTION 'That is not a valid timezone.'; END IF;
  IF (patch ? 'quiet_hours_start' AND (patch->>'quiet_hours_start')::integer NOT BETWEEN 0 AND 23) OR (patch ? 'quiet_hours_end' AND (patch->>'quiet_hours_end')::integer NOT BETWEEN 0 AND 23) THEN RAISE EXCEPTION 'Quiet hours must be between 0 and 23.'; END IF;
  UPDATE public.businesses SET name=COALESCE(patch->>'name',name),phone_number=COALESCE(patch->>'phone_number',phone_number),service_area=COALESCE(patch->>'service_area',service_area),opening_hours=COALESCE(patch->>'opening_hours',opening_hours),sms_signature=COALESCE(patch->>'sms_signature',sms_signature),privacy_policy_url=COALESCE(patch->>'privacy_policy_url',privacy_policy_url),timezone=COALESCE(patch->>'timezone',timezone),quiet_hours_start=COALESCE((patch->>'quiet_hours_start')::integer,quiet_hours_start),quiet_hours_end=COALESCE((patch->>'quiet_hours_end')::integer,quiet_hours_end) WHERE id=b RETURNING id,name INTO r,n;
 ELSE RAISE EXCEPTION 'This assistant action is not enabled.';
 END IF;
 INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(b,auth.uid(),'assistant_'||p_action,CASE WHEN p_action='create_customer' THEN 'lead' WHEN p_action='update_business_settings' THEN 'business' ELSE 'service' END,r,jsonb_build_object('client_id',auth.jwt()->>'client_id','action',p_action));
 RETURN jsonb_build_object('ok',true,'id',r,'name',n);
END; $$;
REVOKE ALL ON FUNCTION public.assistant_account_action(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_account_action(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.mcp_prepare_assistant_text(p_lead_id uuid,p_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; l public.leads%ROWTYPE; thread uuid; msg uuid; proposal jsonb;
BEGIN
 b:=public.mcp_write_business();
 IF p_message IS NULL OR length(btrim(p_message))<2 OR length(p_message)>600 THEN RAISE EXCEPTION 'Text must contain 2 to 600 characters.'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND business_id=b AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found in your business.'; END IF;
 IF l.opted_out_at IS NOT NULL OR l.sms_suppressed_at IS NOT NULL OR l.mobile_number IS NULL THEN RAISE EXCEPTION 'This customer cannot receive texts.'; END IF;
 INSERT INTO public.assistant_threads(business_id,created_by,title,is_default) VALUES(b,auth.uid(),'Ongoing conversation',true) ON CONFLICT(business_id) WHERE is_default=true AND archived_at IS NULL DO UPDATE SET updated_at=now() RETURNING id INTO thread;
 proposal:=jsonb_build_object('kind','send_text','leadId',l.id,'leadName',COALESCE(l.name,'Customer'),'mobileNumber',l.mobile_number,'message',btrim(p_message),'summary','Text ready. It sends only when you confirm.');
 SELECT id INTO msg FROM public.assistant_messages WHERE business_id=b AND thread_id=thread AND role='assistant' AND done IS NULL AND proposals=jsonb_build_array(proposal) ORDER BY created_at DESC LIMIT 1;
 IF msg IS NULL THEN
  INSERT INTO public.assistant_messages(business_id,thread_id,role,parts,proposals) VALUES(b,thread,'assistant',jsonb_build_array(jsonb_build_object('type','text','text','Your connected assistant prepared a text. Review it and confirm below.')),jsonb_build_array(proposal)) RETURNING id INTO msg;
  INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(b,auth.uid(),'mcp_text_prepared','lead',l.id,jsonb_build_object('assistant_message_id',msg,'client_id',auth.jwt()->>'client_id'));
 END IF;
 RETURN jsonb_build_object('prepared',true,'sent',false,'awaiting_confirmation',true,'thread_id',thread,'assistant_message_id',msg,'customer',l.name,'message',btrim(p_message));
END; $$;
REVOKE ALL ON FUNCTION public.mcp_prepare_assistant_text(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_prepare_assistant_text(uuid,text) TO authenticated;