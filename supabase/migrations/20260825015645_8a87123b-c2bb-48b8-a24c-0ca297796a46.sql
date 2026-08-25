CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Move RLS helper functions out of the API-exposed schema so they cannot be
-- invoked directly over the Data API. Existing policies keep working because
-- they reference the functions by identity, not by name.
ALTER FUNCTION public.current_business_id() SET SCHEMA private;
ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.current_business_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_business_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

ALTER FUNCTION private.current_business_id() SET search_path TO public;
ALTER FUNCTION private.has_role(uuid, public.app_role) SET search_path TO public;