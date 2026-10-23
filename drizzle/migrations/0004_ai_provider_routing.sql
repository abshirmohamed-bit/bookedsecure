ALTER TABLE public.ai_gateway_state
  ADD COLUMN IF NOT EXISTS primary_provider text NOT NULL DEFAULT 'lovable' CHECK (primary_provider IN ('lovable','external')),
  ADD COLUMN IF NOT EXISTS lovable_standby boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fast_model text,
  ADD COLUMN IF NOT EXISTS agent_model text,
  ADD COLUMN IF NOT EXISTS last_check jsonb;
INSERT INTO public.ai_gateway_state (id, paused, primary_provider, lovable_standby, fast_model, agent_model)
VALUES ('routing', false, 'lovable', true, 'grok-code-fast-1', 'grok-code-fast-1')
ON CONFLICT (id) DO NOTHING;