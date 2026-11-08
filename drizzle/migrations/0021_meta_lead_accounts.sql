-- Per-business Facebook Page connection for direct lead import.
-- Holds an encrypted Page access token, so it is server-only: RLS on, no client policies.
CREATE TABLE public.meta_lead_accounts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  page_id text CHECK (page_id IS NULL OR page_id ~ '^[0-9]{3,40}$'),
  page_name text,
  token_ciphertext text,
  form_ids text[] NOT NULL DEFAULT '{}',
  pending_pages jsonb,
  pending_expires_at timestamptz,
  connected_by uuid,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((page_id IS NULL) = (token_ciphertext IS NULL))
);
GRANT ALL ON public.meta_lead_accounts TO service_role;
ALTER TABLE public.meta_lead_accounts ENABLE ROW LEVEL SECURITY;
