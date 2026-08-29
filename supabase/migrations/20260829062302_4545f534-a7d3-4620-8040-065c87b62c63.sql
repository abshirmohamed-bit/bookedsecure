CREATE TABLE public.pilot_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  location text,
  weekly_enquiry_volume integer,
  services text,
  challenge text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','active')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  landing_page text,
  internal_notes text,
  duplicate_of uuid REFERENCES public.pilot_applications(id) ON DELETE SET NULL,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid
);

CREATE INDEX pilot_applications_submitted_at_idx ON public.pilot_applications (submitted_at DESC);
CREATE INDEX pilot_applications_status_idx ON public.pilot_applications (status);
CREATE INDEX pilot_applications_email_idx ON public.pilot_applications (lower(email));

GRANT ALL ON public.pilot_applications TO service_role;

ALTER TABLE public.pilot_applications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER pilot_applications_updated
  BEFORE UPDATE ON public.pilot_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();