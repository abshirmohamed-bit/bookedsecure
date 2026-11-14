-- Lovable: please apply this as one migration.
--
-- Co-Work learns (phase 1 of the Hermes plan): what it remembers about this
-- business and its owner (memories), how it did tasks that worked
-- (skills), and how far the background review has read each conversation.
-- Rows belong to one business and are never shared between businesses.
-- They are written only by the server (Co-Work's tools, the review in the
-- follow-ups hook, and the owner's "What Co-Work knows" panel through
-- owner-checked server functions); members of the business can read them.
-- Until this is applied, Co-Work works exactly as before.

CREATE TABLE IF NOT EXISTS public.cowork_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'preference')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 2 AND 400),
  origin text NOT NULL DEFAULT 'cowork' CHECK (origin IN ('owner', 'cowork', 'review')),
  source_thread_id uuid REFERENCES public.assistant_threads (id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS cowork_memories_business_idx ON public.cowork_memories (business_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.cowork_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  when_to_use text NOT NULL CHECK (char_length(when_to_use) BETWEEN 2 AND 240),
  steps text NOT NULL CHECK (char_length(steps) BETWEEN 2 AND 2400),
  origin text NOT NULL DEFAULT 'cowork' CHECK (origin IN ('owner', 'cowork', 'review')),
  uses integer NOT NULL DEFAULT 0,
  source_thread_id uuid REFERENCES public.assistant_threads (id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cowork_skills_name_idx ON public.cowork_skills (business_id, lower(name));

CREATE TABLE IF NOT EXISTS public.cowork_reviews (
  thread_id uuid PRIMARY KEY REFERENCES public.assistant_threads (id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  reviewed_through timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cowork_memories, public.cowork_skills TO authenticated;
GRANT ALL ON public.cowork_memories, public.cowork_skills, public.cowork_reviews TO service_role;
ALTER TABLE public.cowork_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cowork_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cowork_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cowork memories readable in tenant" ON public.cowork_memories;
CREATE POLICY "cowork memories readable in tenant" ON public.cowork_memories
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
DROP POLICY IF EXISTS "cowork skills readable in tenant" ON public.cowork_skills;
CREATE POLICY "cowork skills readable in tenant" ON public.cowork_skills
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
