CREATE TABLE public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'aud',
  monthly_price_minor_units integer NOT NULL,
  annual_price_minor_units integer NOT NULL,
  included_segments integer NOT NULL,
  overage_cents integer NOT NULL,
  reactivation_enabled boolean NOT NULL DEFAULT false,
  team_member_limit integer,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  sort_order integer NOT NULL DEFAULT 0,
  is_offered boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO anon;
GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plans are readable by everyone" ON public.plans FOR SELECT USING (true);

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.plans (id, name, tagline, monthly_price_minor_units, annual_price_minor_units, included_segments, overage_cents, reactivation_enabled, team_member_limit, stripe_monthly_price_id, stripe_annual_price_id, sort_order)
VALUES
  ('essentials', 'Essentials', 'Answer every enquiry in seconds and never lose a follow-up.', 20000, 200000, 800, 9, false, 2, 'essentials_monthly', 'essentials_annual', 1),
  ('pro', 'Pro', 'Everything in Essentials, plus bringing past customers back.', 30000, 300000, 1500, 8, true, NULL, 'pro_monthly', 'pro_annual', 2);

ALTER TABLE public.businesses
  ADD COLUMN plan_id text NOT NULL DEFAULT 'pro' REFERENCES public.plans(id);