ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS image_url text NULL,
  ADD COLUMN IF NOT EXISTS image_storage_path text NULL;

ALTER TABLE public.service_addons
  ADD COLUMN IF NOT EXISTS image_url text NULL,
  ADD COLUMN IF NOT EXISTS image_storage_path text NULL;