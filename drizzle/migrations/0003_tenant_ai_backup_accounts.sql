CREATE TABLE public.tenant_ai_accounts (
 business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider IN ('openai','anthropic','google','xai')),
 model text NOT NULL,
 key_ciphertext text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL
);
GRANT ALL ON public.tenant_ai_accounts TO service_role;
ALTER TABLE public.tenant_ai_accounts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.ai_gateway_state (
 id text PRIMARY KEY,
 paused boolean NOT NULL DEFAULT false,
 reason text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_gateway_state TO service_role;
ALTER TABLE public.ai_gateway_state ENABLE ROW LEVEL SECURITY;