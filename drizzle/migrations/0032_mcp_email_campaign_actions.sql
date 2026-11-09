-- ChatGPT and Claude (OAuth MCP) can run the whole email campaign workflow.
-- Every write first calls this function: it requires the OAuth connection,
-- the business owner and an active plan (mcp_write_business), checks the
-- campaign belongs to the caller's business, and records the action in the
-- audit log in the same transaction. Sending still needs the owner's
-- confirmation code from the preview step, checked in the application.

CREATE OR REPLACE FUNCTION public.mcp_email_campaign_authorize(
  p_action text,
  p_campaign_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid;
BEGIN
  v_business := public.mcp_write_business();
  IF p_action NOT IN ('draft','update','write','preview','send','schedule','unschedule','cancel','stop_follow_ups') THEN
    RAISE EXCEPTION 'Unsupported email campaign action.';
  END IF;
  IF p_campaign_id IS NOT NULL THEN
    PERFORM id FROM public.email_campaigns WHERE id = p_campaign_id AND business_id = v_business;
    IF NOT FOUND THEN RAISE EXCEPTION 'That campaign was not found in your business.'; END IF;
  END IF;
  INSERT INTO public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (v_business, auth.uid(), 'mcp_email_' || p_action, 'email_campaign', p_campaign_id,
          COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('client_id', auth.jwt()->>'client_id'));
  RETURN v_business;
END $$;

REVOKE ALL ON FUNCTION public.mcp_email_campaign_authorize(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_email_campaign_authorize(text, uuid, jsonb) TO authenticated;
