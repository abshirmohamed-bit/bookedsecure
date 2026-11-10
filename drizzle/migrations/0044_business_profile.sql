-- Business profile read from the owner's own website when they set up:
-- what kind of business it is (booked jobs, plans, quotes, products) and what
-- the site says about it (about, features, terms, FAQs). The setup preview,
-- quote page and quote AI chat use it so each business only shows and says
-- what fits. Readable by the business like its other public details.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_profile jsonb;

COMMENT ON COLUMN public.businesses.business_profile IS
  'Industry, business model, summary, highlights, policies, FAQs and suggested enquiry subject read from the business website at setup.';
