UPDATE public.plans
SET included_segments = 0,
    tagline = 'Dedicated Australian number. Texts are paid from credits at 3c each.',
    updated_at = now()
WHERE id = 'founder';

UPDATE public.sms_usage_periods p
SET included_segments = 0,
    updated_at = now()
FROM public.businesses b
WHERE p.business_id = b.id
  AND b.plan_id = 'founder'
  AND p.included_segments <> 0;