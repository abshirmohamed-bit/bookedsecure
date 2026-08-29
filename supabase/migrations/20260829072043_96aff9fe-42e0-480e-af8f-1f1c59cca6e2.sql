-- pilot_applications is service-role-only; platform admins reach it through
-- server functions after requirePlatformAdmin. Explicit client deny resolves
-- the RLS-without-policy linter warning without changing access.
CREATE POLICY "no client access" ON public.pilot_applications
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);