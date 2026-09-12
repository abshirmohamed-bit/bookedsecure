ALTER TABLE public.texto_accounts
  ADD COLUMN IF NOT EXISTS auto_topup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_topup_threshold integer NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS auto_topup_pack_id text NOT NULL DEFAULT 'credits_1500',
  ADD COLUMN IF NOT EXISTS auto_topup_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_topup_failures integer NOT NULL DEFAULT 0;

ALTER TABLE public.credit_topups
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';