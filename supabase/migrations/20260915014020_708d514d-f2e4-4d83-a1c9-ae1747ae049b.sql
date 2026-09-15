ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS quote_subject_label text,
  ADD COLUMN IF NOT EXISTS quote_subject_options text[];

COMMENT ON COLUMN public.businesses.quote_subject_label IS 'Customer-facing label for the item being serviced in quotes and the AI chat. Falls back to "Vehicle" when not set.';
COMMENT ON COLUMN public.businesses.quote_subject_options IS 'Dropdown options for the quote subject (e.g. car sizes, property types). Falls back to the default vehicle options when not set.';

GRANT SELECT, INSERT, UPDATE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;