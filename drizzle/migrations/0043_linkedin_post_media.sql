-- What was attached to a LinkedIn post made from BookedSecure (images, a
-- video or a document), so the post history can show it.
ALTER TABLE public.linkedin_posts
  ADD COLUMN IF NOT EXISTS media jsonb;
