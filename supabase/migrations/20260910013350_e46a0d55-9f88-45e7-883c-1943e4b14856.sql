CREATE TABLE public.assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL DEFAULT 'Ongoing conversation',
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.assistant_threads TO authenticated;
GRANT ALL ON public.assistant_threads TO service_role;
ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant threads tenant read"
  ON public.assistant_threads FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

CREATE UNIQUE INDEX assistant_threads_one_default_idx
  ON public.assistant_threads (business_id)
  WHERE is_default = true AND archived_at IS NULL;
CREATE INDEX assistant_threads_business_updated_idx
  ON public.assistant_threads (business_id, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE TRIGGER assistant_threads_updated
  BEFORE UPDATE ON public.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  done text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant messages tenant read"
  ON public.assistant_messages FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

CREATE INDEX assistant_messages_thread_created_idx
  ON public.assistant_messages (business_id, thread_id, created_at);