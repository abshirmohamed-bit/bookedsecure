-- Clip learning, step 2: how each post did over time.
-- Lovable: please apply this as one migration (same as drizzle/migrations/0066_post_insight_snapshots.sql).
-- Nothing is removed. Post figures keep refreshing before it is applied
-- (linkedin_posts.insights holds the latest); this adds their history.

-- One row each time a post's figures are read: views, likes, comments,
-- shares, saves, reach, and for YouTube watch time and average view
-- duration/percentage. age_hours is the post's age when read, so clips of
-- different ages compare fairly (day 1, day 7, day 30).
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
