CREATE TABLE IF NOT EXISTS public.post_insight_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.linkedin_posts (id) ON DELETE CASCADE,
  platform text NOT NULL,
  age_hours integer NOT NULL,
  metrics jsonb NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_insight_snapshots_post_idx ON public.post_insight_snapshots (post_id, taken_at);
CREATE INDEX IF NOT EXISTS post_insight_snapshots_business_idx ON public.post_insight_snapshots (business_id, taken_at DESC);
REVOKE ALL ON public.post_insight_snapshots FROM anon, authenticated;
GRANT SELECT ON public.post_insight_snapshots TO authenticated;
GRANT ALL ON public.post_insight_snapshots TO service_role;
ALTER TABLE public.post_insight_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_insight_snapshots_read ON public.post_insight_snapshots;
CREATE POLICY post_insight_snapshots_read ON public.post_insight_snapshots FOR SELECT TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));