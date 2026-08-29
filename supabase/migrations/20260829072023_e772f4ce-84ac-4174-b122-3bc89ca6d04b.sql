-- These tables are service-role-only (service role bypasses RLS).
-- Explicit deny policies for client roles resolve the RLS-without-policy
-- linter warnings while keeping the tables fully locked down.
CREATE POLICY "no client access" ON public.commercial_config
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "no client access" ON public.sms_usage_periods
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "no client access" ON public.stripe_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);