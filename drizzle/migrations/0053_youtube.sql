-- YouTube posting. Lovable: please apply this as one migration, exactly as written.
-- 1) Video uploads share the social post history table.
DO $$
DECLARE c record;
BEGIN
  -- Drop whichever check currently limits the platform column (its name may vary).
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.linkedin_posts'::regclass AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%platform%'
  LOOP
    EXECUTE format('ALTER TABLE public.linkedin_posts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.linkedin_posts ADD CONSTRAINT linkedin_posts_platform_check
  CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'youtube'));

-- 2) One YouTube channel per business. Server-only: tokens are AES-GCM encrypted
--    and bound to the business; no browser role can read or write this table.
CREATE TABLE IF NOT EXISTS public.youtube_accounts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_title text,
  channel_handle text,
  channel_thumbnail text,
  refresh_token_ciphertext text NOT NULL,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.youtube_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.youtube_accounts FROM anon, authenticated;
GRANT ALL ON public.youtube_accounts TO service_role;
