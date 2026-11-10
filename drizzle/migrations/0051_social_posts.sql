-- Social media posting: Facebook and Instagram posts share the LinkedIn post
-- history table. Lovable: please apply this as one migration. It only adds
-- two columns; existing rows become LinkedIn posts.
ALTER TABLE public.linkedin_posts
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'linkedin'
    CHECK (platform IN ('linkedin', 'facebook', 'instagram')),
  ADD COLUMN IF NOT EXISTS permalink text;
CREATE INDEX IF NOT EXISTS linkedin_posts_platform_idx
  ON public.linkedin_posts (business_id, platform, created_at DESC);
