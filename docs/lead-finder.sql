-- Lead finder: businesses found for a tenant's outreach. Lovable: please apply this
-- as one migration exactly as written. Server-written; business members can read
-- their own rows. Nothing here sends a message.

CREATE TABLE IF NOT EXISTS public.lead_finder_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  query text NOT NULL,
  area text NOT NULL,
  criteria text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  found_count integer NOT NULL DEFAULT 0,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_finder_searches_business_idx ON public.lead_finder_searches (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_finder_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  search_id uuid REFERENCES public.lead_finder_searches(id) ON DELETE SET NULL,
  place_id text NOT NULL,
  name text NOT NULL,
  category text,
  address text,
  suburb text,
  phone text,
  website text,
  rating numeric,
  review_count integer,
  summary text,
  email text,
  email_status text NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'unverified', 'valid', 'risky', 'invalid')),
  fit text NOT NULL DEFAULT 'unknown' CHECK (fit IN ('good', 'maybe', 'no', 'unknown')),
  fit_reason text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'added', 'dismissed')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, place_id)
);
CREATE INDEX IF NOT EXISTS lead_finder_prospects_search_idx ON public.lead_finder_prospects (business_id, search_id);

ALTER TABLE public.lead_finder_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_finder_prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business members view their lead finder searches" ON public.lead_finder_searches
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
CREATE POLICY "Business members view their found businesses" ON public.lead_finder_prospects
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
GRANT SELECT ON public.lead_finder_searches, public.lead_finder_prospects TO authenticated;
GRANT ALL ON public.lead_finder_searches, public.lead_finder_prospects TO service_role;
