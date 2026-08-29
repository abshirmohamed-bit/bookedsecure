ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS processed_at          timestamptz NULL,
  ADD COLUMN IF NOT EXISTS processing_error      text NULL;

COMMENT ON COLUMN public.webhook_events.processing_error IS
  'Short diagnostic reason only (truncated, no payload bodies, numbers or credentials).';

UPDATE public.webhook_events
   SET processed_at = created_at
 WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx
  ON public.webhook_events (provider, created_at)
  WHERE processed_at IS NULL;