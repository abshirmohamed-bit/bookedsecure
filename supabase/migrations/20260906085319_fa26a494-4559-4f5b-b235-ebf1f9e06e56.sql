ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS logo_storage_path text;

DROP POLICY IF EXISTS "Tenant staff can read their own business logo" ON storage.objects;
CREATE POLICY "Tenant staff can read their own business logo"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] IN (
    SELECT p.business_id::text FROM public.profiles p
    WHERE p.id = auth.uid() AND p.business_id IS NOT NULL
  )
);