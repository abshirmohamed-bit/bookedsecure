CREATE TABLE public.provider_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('number_rental', 'credits', 'message')),
  quantity integer NOT NULL DEFAULT 1,
  amount_cents integer NOT NULL,
  source text,
  source_ref text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_costs_business_month ON public.provider_costs (business_id, month);
CREATE UNIQUE INDEX idx_provider_costs_source_ref ON public.provider_costs (kind, source_ref)
  WHERE source_ref IS NOT NULL;

GRANT ALL ON public.provider_costs TO service_role;
ALTER TABLE public.provider_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no client access" ON public.provider_costs FOR ALL USING (false);

CREATE TRIGGER provider_costs_updated
  BEFORE UPDATE ON public.provider_costs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tenant_month_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month date NOT NULL,
  revenue_cents integer NOT NULL DEFAULT 0,
  provider_cost_cents integer NOT NULL DEFAULT 0,
  margin_cents integer NOT NULL DEFAULT 0,
  segments_sent integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, month)
);

GRANT ALL ON public.tenant_month_statements TO service_role;
ALTER TABLE public.tenant_month_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no client access" ON public.tenant_month_statements FOR ALL USING (false);

CREATE TRIGGER tenant_month_statements_updated
  BEFORE UPDATE ON public.tenant_month_statements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();