CREATE TABLE public.social_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'facebook',
  comment_id text NOT NULL,
  comment_url text,
  post_id text,
  post_text text,
  author_name text,
  comment_text text NOT NULL,
  sentiment text,
  needs_response boolean NOT NULL DEFAULT true,
  response_reason text,
  draft_response text,
  approved_response text,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','posted','dismissed','failed')),
  approved_at timestamptz,
  approved_by uuid,
  posted_at timestamptz,
  post_error text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  commented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, platform, comment_id)
);
GRANT SELECT ON public.social_comments TO authenticated;
GRANT ALL ON public.social_comments TO service_role;
ALTER TABLE public.social_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business members view social comments" ON public.social_comments
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());
CREATE INDEX social_comments_business_status_idx ON public.social_comments (business_id, status, created_at DESC);
CREATE TRIGGER social_comments_updated_at BEFORE UPDATE ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.notify_on_social_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending_review' AND NEW.needs_response THEN
    PERFORM public.push_owner_notification(NEW.business_id, NULL, 'social_comment',
      'New ' || initcap(NEW.platform) || ' comment to review',
      coalesce(NEW.author_name || ': ', '') || left(NEW.comment_text, 200),
      'social_comment:' || NEW.id::text,
      jsonb_build_object('social_comment_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER social_comments_notify AFTER INSERT ON public.social_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_social_comment();