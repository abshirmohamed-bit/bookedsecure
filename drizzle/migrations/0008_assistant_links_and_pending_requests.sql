DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.assistant_operational_action(text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'DELETE FROM public.service_addon_links WHERE addon_id=r AND service_id=l','DELETE FROM public.service_addon_links WHERE business_id=b AND addon_id=r AND service_id=l');
 definition:=replace(definition,'INSERT INTO public.service_addon_links(service_id,addon_id) VALUES(l,r)','INSERT INTO public.service_addon_links(business_id,service_id,addon_id) VALUES(b,l,r)');
 EXECUTE definition;
END $$;
CREATE OR REPLACE FUNCTION public.prepare_connected_assistant_request(p_request text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; thread uuid; msg uuid; proposal jsonb;
BEGIN
 b:=public.assistant_action_business(true,true);
 IF p_request IS NULL OR length(btrim(p_request)) NOT BETWEEN 2 AND 1000 THEN RAISE EXCEPTION 'Describe the requested work in 2 to 1000 characters.'; END IF;
 INSERT INTO public.assistant_threads(business_id,created_by,title,is_default) VALUES(b,auth.uid(),'Ongoing conversation',true) ON CONFLICT(business_id) WHERE is_default=true AND archived_at IS NULL DO UPDATE SET updated_at=now() RETURNING id INTO thread;
 proposal:=jsonb_build_object('kind','assistant_request','request',btrim(p_request),'summary','Review this connected-assistant request, then confirm to run it with Cowork. Messages and imports still require their own approval.');
 INSERT INTO public.assistant_messages(business_id,thread_id,role,parts,proposals) VALUES(b,thread,'assistant',jsonb_build_array(jsonb_build_object('type','text','text','Your connected assistant requested: '||btrim(p_request))),jsonb_build_array(proposal)) RETURNING id INTO msg;
 INSERT INTO public.audit_events(business_id,user_id,event_type,entity_type,entity_id,metadata) VALUES(b,auth.uid(),'connected_assistant_request_prepared','business',b,jsonb_build_object('assistant_message_id',msg,'client_id',auth.jwt()->>'client_id'));
 RETURN jsonb_build_object('prepared',true,'executed',false,'awaiting_confirmation',true,'thread_id',thread,'assistant_message_id',msg);
END $$;
REVOKE ALL ON FUNCTION public.prepare_connected_assistant_request(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_connected_assistant_request(text) TO authenticated;