-- Co-Work routines: member-readable, server-written, scoped to a business.
-- User identity is stored as a plain UUID, in accordance with managed auth boundaries.
CREATE TABLE IF NOT EXISTS public.cowork_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'watch_channel')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  prompt text NOT NULL DEFAULT '' CHECK (char_length(prompt) <= 1200),
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  deliver_email boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  thread_id uuid REFERENCES public.assistant_threads (id) ON DELETE SET NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  running_since timestamptz,
  last_status text CHECK (last_status IS NULL OR last_status IN ('ok', 'failed', 'skipped')),
  last_result text,
  runs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cowork_routines TO authenticated;
GRANT ALL ON public.cowork_routines TO service_role;
ALTER TABLE public.cowork_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cowork routines readable in tenant" ON public.cowork_routines;
CREATE POLICY "cowork routines readable in tenant" ON public.cowork_routines
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
CREATE INDEX IF NOT EXISTS cowork_routines_due_idx ON public.cowork_routines (next_run_at) WHERE enabled;
CREATE INDEX IF NOT EXISTS cowork_routines_business_idx ON public.cowork_routines (business_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS cowork_routines_one_watch_idx ON public.cowork_routines (business_id) WHERE kind = 'watch_channel';