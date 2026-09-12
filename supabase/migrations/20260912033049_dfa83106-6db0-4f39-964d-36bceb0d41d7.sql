CREATE TABLE public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid,
  kind text NOT NULL CHECK (kind IN ('feature_request', 'issue_report')),
  message text NOT NULL,
  page_path text,
  contact_email text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'in_progress', 'closed')),
  internal_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_submissions_business_created_idx
  ON public.feedback_submissions (business_id, created_at DESC);
CREATE INDEX feedback_submissions_status_created_idx
  ON public.feedback_submissions (status, created_at DESC);

GRANT SELECT, INSERT ON public.feedback_submissions TO authenticated;
GRANT ALL ON public.feedback_submissions TO service_role;

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feedback read own business or platform admin"
  ON public.feedback_submissions FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    OR private.has_role(auth.uid(), 'platform_admin'::public.app_role)
  );

CREATE POLICY "feedback insert own business"
  ON public.feedback_submissions FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "feedback platform admin update"
  ON public.feedback_submissions FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'platform_admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'platform_admin'::public.app_role));

CREATE TRIGGER feedback_submissions_updated
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();