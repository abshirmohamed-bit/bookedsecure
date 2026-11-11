-- Lead finder through ChatGPT and Claude (MCP). Lovable: please apply this as one
-- migration exactly as written. It adds one function and changes nothing else.
--
-- Owner-only, plan-checked (assistant_action_business), tenant from auth.uid(),
-- and audited before the action runs. Returns the caller's business id.
CREATE OR REPLACE FUNCTION public.mcp_lead_finder_authorize(p_action text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b uuid;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('suggest', 'search', 'add') THEN
    RAISE EXCEPTION 'Unsupported Lead finder action.';
  END IF;
  b := public.assistant_action_business(true, true);
  INSERT INTO public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
    VALUES (b, auth.uid(), 'mcp_lead_finder_' || p_action, 'business', b,
          jsonb_build_object('source', 'mcp') || COALESCE(p_metadata, '{}'::jsonb));
  RETURN b;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_lead_finder_authorize(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_lead_finder_authorize(text, jsonb) TO authenticated;
