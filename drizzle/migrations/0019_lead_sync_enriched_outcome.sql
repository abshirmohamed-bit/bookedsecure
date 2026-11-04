ALTER TABLE public.lead_sync_items DROP CONSTRAINT lead_sync_items_outcome_check;
ALTER TABLE public.lead_sync_items ADD CONSTRAINT lead_sync_items_outcome_check CHECK (outcome = ANY (ARRAY['created'::text, 'duplicate'::text, 'enriched'::text, 'skipped'::text, 'failed'::text]));
ALTER TABLE public.lead_sync_runs ADD COLUMN enriched_count integer NOT NULL DEFAULT 0;