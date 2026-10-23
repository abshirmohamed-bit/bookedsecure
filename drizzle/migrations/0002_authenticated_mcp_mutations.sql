CREATE OR REPLACE FUNCTION public.mcp_write_business() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_status text; v_end timestamptz; v_past_due timestamptz; v_platform boolean;
BEGIN
 IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'client_id','') = '' THEN RAISE EXCEPTION 'An authorized OAuth connection is required.'; END IF;
 SELECT business_id INTO v_business FROM public.profiles WHERE id=auth.uid() AND active=true;
 IF v_business IS NULL THEN RAISE EXCEPTION 'An active business account is required.'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='platform_admin') INTO v_platform;
 IF NOT v_platform AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner') THEN RAISE EXCEPTION 'Only the business owner can change data through this connection.'; END IF;
 SELECT subscription_status,current_period_end,past_due_since INTO v_status,v_end,v_past_due FROM public.businesses WHERE id=v_business;
 IF NOT v_platform AND NOT (v_status='active' OR (v_status IN ('trialing','canceled') AND v_end>now()) OR (v_status='past_due' AND (v_past_due IS NULL OR v_past_due+interval '7 days'>now()))) THEN RAISE EXCEPTION 'Your trial or subscription has ended. Contact BookedSecure to restore write access.'; END IF;
 RETURN v_business;
END; $$;
REVOKE ALL ON FUNCTION public.mcp_write_business() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_write_business() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_update_lead_notes(p_lead_id uuid,p_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid;
BEGIN
 v_business := public.mcp_write_business();
 IF p_notes IS NULL OR length(p_notes)>5000 THEN RAISE EXCEPTION 'Notes must be text of at most 5000 characters.'; END IF;
 PERFORM id FROM public.leads WHERE id=p_lead_id AND business_id=v_business AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active lead not found in your business.'; END IF;
 UPDATE public.leads SET notes=p_notes WHERE id=p_lead_id AND business_id=v_business;
 INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(v_business,auth.uid(),'mcp_lead_notes_updated','lead',p_lead_id,jsonb_build_object('fields',jsonb_build_array('notes'),'client_id',auth.jwt()->>'client_id'));
 RETURN p_lead_id;
END; $$;
REVOKE ALL ON FUNCTION public.mcp_update_lead_notes(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_update_lead_notes(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_schedule_job(p_lead_id uuid,p_scheduled_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_job uuid;
BEGIN
 v_business := public.mcp_write_business();
 IF p_scheduled_at IS NULL OR p_scheduled_at<=now() THEN RAISE EXCEPTION 'Choose a future appointment time with a timezone.'; END IF;
 v_job := public.schedule_owner_job(v_business,p_lead_id,p_scheduled_at);
 INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(v_business,auth.uid(),'mcp_job_scheduled','job',v_job,jsonb_build_object('lead_id',p_lead_id,'scheduled_at',p_scheduled_at,'client_id',auth.jwt()->>'client_id'));
 RETURN v_job;
END; $$;
REVOKE ALL ON FUNCTION public.mcp_schedule_job(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_schedule_job(uuid,timestamptz) TO authenticated;