-- Remove inherited broad privileges; Co-Work writes must stay server-only.
REVOKE ALL ON public.cowork_memories, public.cowork_skills, public.cowork_reviews, public.cowork_routines FROM anon, authenticated;
GRANT SELECT ON public.cowork_memories, public.cowork_skills, public.cowork_routines TO authenticated;
GRANT ALL ON public.cowork_memories, public.cowork_skills, public.cowork_reviews, public.cowork_routines TO service_role;