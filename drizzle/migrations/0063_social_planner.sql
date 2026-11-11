-- Social planner: drafts, approval before publishing, and post performance.
--
-- Posts stay in the one posts table (linkedin_posts, platform column). Two new
-- statuses come before scheduling: 'draft' (being written) and
-- 'pending_approval' (waiting for the owner). The owner's approval publishes it
-- now or schedules it for its planned time (scheduled_for), through the same
-- scheduler as before. insights holds the latest performance figures read from
-- Facebook or Instagram, and insights_at when they were read.

ALTER TABLE public.linkedin_posts DROP CONSTRAINT IF EXISTS linkedin_posts_status_check;
ALTER TABLE public.linkedin_posts ADD CONSTRAINT linkedin_posts_status_check
  CHECK (status IN ('draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));

ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS insights jsonb;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS insights_at timestamptz;

CREATE INDEX IF NOT EXISTS linkedin_posts_planner_idx
  ON public.linkedin_posts (business_id, coalesce(published_at, scheduled_for, created_at));
