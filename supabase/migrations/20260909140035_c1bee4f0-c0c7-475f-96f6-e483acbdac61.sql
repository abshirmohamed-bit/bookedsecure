ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.service_addons ADD COLUMN IF NOT EXISTS category text;