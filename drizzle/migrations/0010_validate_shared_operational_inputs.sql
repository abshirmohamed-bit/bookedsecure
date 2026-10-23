DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.assistant_operational_action(text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'''new'',''contacted'',''waiting_for_customer'',''replied'',''quote_ready'',''quote_sent'',''scheduled'',''completed'',''lost'',''opted_out'',''invalid''','''new'',''previous_lead'',''contacted'',''waiting_for_customer'',''customer_replied'',''ready_for_quote'',''quote_sent'',''scheduled'',''completed'',''lost'',''opted_out'',''invalid''');
 definition:=replace(definition,'jsonb_array_elements_text(p_input->''fromStatuses'')','jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_input->''fromStatuses'')=''array'' THEN p_input->''fromStatuses'' ELSE ''[]''::jsonb END)');
 definition:=replace(definition,'IF jsonb_array_length(p_input->''serviceIds'') NOT BETWEEN 1 AND 200','IF COALESCE(jsonb_typeof(p_input->''serviceIds''),'''')<>''array'' OR COALESCE(jsonb_array_length(p_input->''serviceIds''),0) NOT BETWEEN 1 AND 200 OR COALESCE(jsonb_typeof(p_input->''remove''),'''')<>''boolean''');
 definition:=replace(definition,'OR p_input->>''mode'' NOT IN','OR COALESCE(p_input->>''mode'','''') NOT IN');
 definition:=replace(definition,'OR jsonb_typeof(p_input->''paused'')<>''boolean''','OR COALESCE(jsonb_typeof(p_input->''paused''),'''')<>''boolean''');
 definition:=replace(definition,'IF p_action=''set_customer_follow_ups'' THEN UPDATE','IF p_action=''set_customer_follow_ups'' THEN IF COALESCE(jsonb_typeof(p_input->''paused''),'''')<>''boolean'' THEN RAISE EXCEPTION ''Pause state is required.''; END IF; UPDATE');
 definition:=replace(definition,'IF n NOT BETWEEN 1 AND 20','IF n IS NULL OR n NOT BETWEEN 1 AND 20');
 definition:=replace(definition,'IF p_input->>''toStatus'' NOT IN','IF COALESCE(p_input->>''toStatus'','''') NOT IN');
 EXECUTE definition;
END $$;