CREATE TABLE public.lead_sync_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'make' CHECK (provider IN ('make','meta_direct')),
  trigger_url text,
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  initial_lookback_days integer NOT NULL DEFAULT 7 CHECK (initial_lookback_days BETWEEN 1 AND 90),
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','disconnected')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_check_at timestamptz,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);
GRANT ALL ON public.lead_sync_connections TO service_role;
ALTER TABLE public.lead_sync_connections ENABLE ROW LEVEL SECURITY;
-- No client policies: the trigger URL is a credential; owners read safe columns through server functions.

CREATE TABLE public.lead_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.lead_sync_connections(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual','schedule')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','running','completed','partial','failed','expired')),
  since timestamptz NOT NULL,
  requested_by uuid,
  created_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX lead_sync_runs_one_active ON public.lead_sync_runs (connection_id) WHERE status IN ('requested','running');
CREATE INDEX lead_sync_runs_business_idx ON public.lead_sync_runs (business_id, requested_at DESC);
GRANT SELECT ON public.lead_sync_runs TO authenticated;
GRANT ALL ON public.lead_sync_runs TO service_role;
ALTER TABLE public.lead_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own sync runs" ON public.lead_sync_runs FOR SELECT TO authenticated
  USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid() AND p.active));

CREATE TABLE public.lead_sync_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.lead_sync_runs(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  meta_lead_id text NOT NULL,
  form_id text,
  form_name text,
  page_id text,
  submitted_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('created','duplicate','skipped','failed')),
  reason text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, meta_lead_id)
);
CREATE INDEX lead_sync_items_run_idx ON public.lead_sync_items (run_id);
GRANT SELECT ON public.lead_sync_items TO authenticated;
GRANT ALL ON public.lead_sync_items TO service_role;
ALTER TABLE public.lead_sync_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own sync items" ON public.lead_sync_items FOR SELECT TO authenticated
  USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid() AND p.active));

CREATE TABLE public.lead_sync_form_checkpoints (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.lead_sync_connections(id) ON DELETE CASCADE,
  form_id text NOT NULL,
  form_name text,
  page_id text,
  last_submitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, form_id)
);
GRANT SELECT ON public.lead_sync_form_checkpoints TO authenticated;
GRANT ALL ON public.lead_sync_form_checkpoints TO service_role;
ALTER TABLE public.lead_sync_form_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own form checkpoints" ON public.lead_sync_form_checkpoints FOR SELECT TO authenticated
  USING (business_id IN (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid() AND p.active));

CREATE TRIGGER lead_sync_connections_updated BEFORE UPDATE ON public.lead_sync_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();