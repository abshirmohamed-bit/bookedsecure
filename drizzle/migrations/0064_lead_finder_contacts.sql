-- Lead finder: who the website names as in charge, and its size as stated there.
-- Optional: Lead finder works without these columns and starts filling them once they exist.
ALTER TABLE public.lead_finder_prospects ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.lead_finder_prospects ADD COLUMN IF NOT EXISTS contact_role text;
ALTER TABLE public.lead_finder_prospects ADD COLUMN IF NOT EXISTS size_hint text;
