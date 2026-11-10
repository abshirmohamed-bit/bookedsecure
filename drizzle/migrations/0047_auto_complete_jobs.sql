-- "Complete jobs automatically": when on, a booked job counts as done once its
-- time has passed (unless the owner cancelled it), and its value comes from the
-- business's own service price so Completed work rises straight away. Off by
-- default; each business owner chooses in Automations.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS auto_complete_jobs boolean NOT NULL DEFAULT false;
