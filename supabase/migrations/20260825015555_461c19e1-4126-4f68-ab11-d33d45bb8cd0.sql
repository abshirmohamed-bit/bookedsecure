-- Trigger-only function: must not be callable through the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Helper functions used by RLS policies: keep them for signed-in users only,
-- remove blanket PUBLIC/anon execute rights.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_business_id() TO authenticated, service_role;

-- Non-definer trigger helper: also trigger-only
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;