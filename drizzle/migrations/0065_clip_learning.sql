-- Clip learning, step 1: what the Engine made, and what the owner changed.
-- Same as docs/clip-learning.sql (the copy Lovable applies).
-- Nothing is removed. Clipping and posting keep working before it is applied;
-- the app starts recording once these exist.

-- What the Engine made, kept as it was so later edits can be compared with it:
-- title, times, score, grades, layout, caption style, zoom, focus, headline, hook line.
ALTER TABLE public.video_clips ADD COLUMN IF NOT EXISTS original jsonb;

-- Which clip a post came from (set when a clip is posted).
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS video_clip_id uuid;
CREATE INDEX IF NOT EXISTS linkedin_posts_video_clip_idx
  ON public.linkedin_posts (video_clip_id) WHERE video_clip_id IS NOT NULL;

-- Every change the owner makes to a clip, and when it is posted or deleted.
-- clip_id and job_id are not foreign keys on purpose: deleting a video removes
-- its clips, and the 'deleted' rows must outlive them.
CREATE TABLE IF NOT EXISTS public.video_clip_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  clip_id uuid,
  job_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'title_changed', 'headline_changed', 'trimmed', 'layout_changed', 'caption_changed',
    'zoom_changed', 'shape_changed', 'deleted', 'posted')),
  before jsonb,
  after jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_clip_events_business_idx ON public.video_clip_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_clip_events_clip_idx ON public.video_clip_events (clip_id);

REVOKE ALL ON public.video_clip_events FROM anon, authenticated;
GRANT SELECT ON public.video_clip_events TO authenticated;
GRANT ALL ON public.video_clip_events TO service_role;
ALTER TABLE public.video_clip_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_clip_events_read ON public.video_clip_events;
CREATE POLICY video_clip_events_read ON public.video_clip_events FOR SELECT TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));
