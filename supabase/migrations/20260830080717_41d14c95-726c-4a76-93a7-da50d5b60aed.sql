CREATE TABLE public.import_automation_state (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'preview_only',
  mode_reason text,
  paused boolean NOT NULL DEFAULT false,
  canary_passed_at timestamptz,
  canary_batch_id uuid,
  canary_row_number integer,
  canary_lead_id uuid,
  idempotency_verified_at timestamptz,
  bounded_batch_passed_at timestamptz,
  bounded_batch_batch_id uuid,
  bounded_batch_imported integer NOT NULL DEFAULT 0,
  exception_only_enabled_at timestamptz,
  last_summary jsonb,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.import_automation_state TO authenticated;
GRANT ALL ON public.import_automation_state TO service_role;

ALTER TABLE public.import_automation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import automation readable in tenant"
  ON public.import_automation_state
  FOR SELECT
  TO authenticated
  USING (business_id IN (SELECT profiles.business_id FROM public.profiles WHERE profiles.id = auth.uid()));

CREATE TRIGGER import_automation_state_updated
  BEFORE UPDATE ON public.import_automation_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();