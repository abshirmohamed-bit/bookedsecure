ALTER TABLE public.services ADD COLUMN duration_minutes integer;

UPDATE public.services s
SET duration_minutes = COALESCE(
  (SELECT ba.slot_minutes FROM public.booking_availability ba WHERE ba.business_id = s.business_id),
  120
);

ALTER TABLE public.services
  ADD CONSTRAINT services_duration_minutes_positive
    CHECK (duration_minutes IS NULL OR (duration_minutes > 0 AND duration_minutes <= 1440)),
  ADD CONSTRAINT services_active_requires_duration
    CHECK (active = false OR (duration_minutes IS NOT NULL AND duration_minutes > 0));

ALTER TABLE public.booking_availability DROP COLUMN slot_minutes;