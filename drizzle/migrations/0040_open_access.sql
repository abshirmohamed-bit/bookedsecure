-- Open access for now.
--
-- 1. Every new sign-up already starts a 14-day trial (handle_new_user). During
--    the trial the app unlocks every feature, whatever the plan.
-- 2. Businesses that signed up before trials existed, and are still in preview
--    with no paid subscription, get a fresh 14-day trial from today.
-- 3. complimentary_access: full access to everything at no charge, switched on
--    per business by a platform admin in the control room. Stripe events never
--    change a complimentary business's access. The status is kept 'active' so
--    database-side checks (assistant and MCP actions) allow it too.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS complimentary_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.complimentary_access IS
  'Full access at no charge, set by a platform admin. Stripe events do not change access while true.';

UPDATE public.businesses
SET subscription_status = 'trialing',
    current_period_start = now(),
    current_period_end = now() + interval '14 days',
    subscription_updated_at = now()
WHERE subscription_status = 'preview'
  AND stripe_subscription_id IS NULL
  AND complimentary_access = false;
