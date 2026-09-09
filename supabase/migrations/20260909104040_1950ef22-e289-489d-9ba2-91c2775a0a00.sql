CREATE TABLE public.texto_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'texto',
  subaccount_id text,
  subaccount_reference text,
  daily_send_cap integer NOT NULL DEFAULT 100,
  credit_balance numeric NOT NULL DEFAULT 0,
  allocated_credits numeric NOT NULL DEFAULT 0,
  provisioned_at timestamptz,
  provisioning_state text NOT NULL DEFAULT 'not_started',
  failed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX idx_texto_accounts_business_id ON public.texto_accounts(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.texto_accounts TO authenticated;
GRANT ALL ON public.texto_accounts TO service_role;

ALTER TABLE public.texto_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "texto_accounts tenant" ON public.texto_accounts
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());

CREATE TABLE public.texto_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'texto',
  provider_number_id text,
  monthly_cost_cents integer NOT NULL DEFAULT 1500,
  status text NOT NULL DEFAULT 'available',
  assigned_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  recalled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_texto_numbers_assigned_business ON public.texto_numbers(assigned_business_id);
CREATE INDEX idx_texto_numbers_status ON public.texto_numbers(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.texto_numbers TO authenticated;
GRANT ALL ON public.texto_numbers TO service_role;

ALTER TABLE public.texto_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "texto_numbers tenant" ON public.texto_numbers
  FOR SELECT TO authenticated
  USING (assigned_business_id = private.current_business_id());

ALTER TABLE public.sms_senders
  ADD COLUMN IF NOT EXISTS texto_account_id uuid REFERENCES public.texto_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_sms_senders_texto_account_id ON public.sms_senders(texto_account_id);

CREATE TRIGGER texto_accounts_updated BEFORE UPDATE ON public.texto_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER texto_numbers_updated BEFORE UPDATE ON public.texto_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
