-- LinkedIn posting. Each business connects its own LinkedIn account (official
-- OAuth: "Share on LinkedIn" for the owner's profile, and Community Management
-- for Company Pages once LinkedIn approves the app). The access token is kept
-- AES-GCM-encrypted and bound to the business in a server-only table; tenants
-- can read their own post history. Direct messages are not part of this:
-- LinkedIn only offers messaging to closed partners.

CREATE TABLE IF NOT EXISTS public.linkedin_accounts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  member_urn text NOT NULL,
  member_name text,
  token_ciphertext text NOT NULL,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  organizations jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_author_urn text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-only: no grants to authenticated, RLS on with no policies.
REVOKE ALL ON public.linkedin_accounts FROM anon, authenticated;
GRANT ALL ON public.linkedin_accounts TO service_role;
ALTER TABLE public.linkedin_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.linkedin_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  author_urn text NOT NULL,
  author_name text,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'publishing' CHECK (status IN ('publishing', 'published', 'failed')),
  post_urn text,
  error text,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'assistant', 'mcp')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS linkedin_posts_business_idx ON public.linkedin_posts (business_id, created_at DESC);

GRANT SELECT ON public.linkedin_posts TO authenticated;
GRANT ALL ON public.linkedin_posts TO service_role;
ALTER TABLE public.linkedin_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "linkedin posts readable in tenant" ON public.linkedin_posts;
CREATE POLICY "linkedin posts readable in tenant" ON public.linkedin_posts
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

-- ChatGPT and Claude (OAuth MCP): every LinkedIn write first calls this. It
-- requires the OAuth connection, the owner and an active plan
-- (mcp_write_business) and writes the audit entry in the same transaction.
-- Publishing still needs the confirmation code from the preview step.
CREATE OR REPLACE FUNCTION public.mcp_linkedin_authorize(
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid;
BEGIN
  v_business := public.mcp_write_business();
  IF p_action NOT IN ('write', 'preview', 'publish') THEN
    RAISE EXCEPTION 'Unsupported LinkedIn action.';
  END IF;
  INSERT INTO public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (v_business, auth.uid(), 'mcp_linkedin_' || p_action, 'business', v_business,
          COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('client_id', auth.jwt()->>'client_id'));
  RETURN v_business;
END $$;

REVOKE ALL ON FUNCTION public.mcp_linkedin_authorize(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_linkedin_authorize(text, jsonb) TO authenticated;
