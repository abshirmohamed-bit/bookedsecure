-- Scheduled social posts (Facebook, Instagram). Lovable: please apply this as one
-- migration. It widens the post status list and adds two columns; nothing is removed.
ALTER TABLE public.linkedin_posts DROP CONSTRAINT IF EXISTS linkedin_posts_status_check;
ALTER TABLE public.linkedin_posts ADD CONSTRAINT linkedin_posts_status_check
  CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'cancelled'));
ALTER TABLE public.linkedin_posts
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS payload jsonb;
CREATE INDEX IF NOT EXISTS linkedin_posts_due_idx
  ON public.linkedin_posts (scheduled_for) WHERE status = 'scheduled';
