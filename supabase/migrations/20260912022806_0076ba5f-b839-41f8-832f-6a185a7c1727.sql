CREATE TABLE public.assistant_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  uploaded_by uuid,
  filename text NOT NULL,
  content text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX assistant_files_recent_idx ON public.assistant_files (business_id, thread_id, created_at DESC);

GRANT SELECT ON public.assistant_files TO authenticated;
GRANT ALL ON public.assistant_files TO service_role;

ALTER TABLE public.assistant_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assistant files tenant read" ON public.assistant_files
FOR SELECT TO authenticated
USING (business_id = private.current_business_id());