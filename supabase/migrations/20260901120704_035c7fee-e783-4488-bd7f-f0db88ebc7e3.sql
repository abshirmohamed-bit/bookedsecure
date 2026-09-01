-- Owner-controlled, tenant-scoped bookable availability. Deliberately separate
-- from businesses.opening_hours, which is free text and never bookable.
CREATE TABLE public.booking_availability (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  slot_minutes integer NOT NULL DEFAULT 120,
  lead_time_minutes integer NOT NULL DEFAULT 120,
  horizon_days integer NOT NULL DEFAULT 7,
  offer_ttl_minutes integer NOT NULL DEFAULT 120,
  -- [{ "weekday": 1, "start": "09:00", "end": "16:00" }, ...] weekday 0=Sunday
  weekly_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_availability_slot_minutes_check CHECK (slot_minutes BETWEEN 30 AND 480),
  CONSTRAINT booking_availability_lead_time_check CHECK (lead_time_minutes BETWEEN 0 AND 10080),
  CONSTRAINT booking_availability_horizon_check CHECK (horizon_days BETWEEN 1 AND 30),
  CONSTRAINT booking_availability_ttl_check CHECK (offer_ttl_minutes BETWEEN 15 AND 1440),
  CONSTRAINT booking_availability_windows_array CHECK (jsonb_typeof(weekly_windows) = 'array')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_availability TO authenticated;
GRANT ALL ON public.booking_availability TO service_role;
ALTER TABLE public.booking_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking availability tenant" ON public.booking_availability
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());
CREATE TRIGGER booking_availability_updated
  BEFORE UPDATE ON public.booking_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Server-generated appointment options. AI may only present rows from here.
CREATE TABLE public.booking_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name_snapshot text,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'offered',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  confirmed_by uuid,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_offers_status_check
    CHECK (status = ANY (ARRAY['offered'::text, 'accepted'::text, 'confirmed'::text, 'expired'::text, 'withdrawn'::text])),
  CONSTRAINT booking_offers_slot_order_check CHECK (slot_end > slot_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_offers TO authenticated;
GRANT ALL ON public.booking_offers TO service_role;
ALTER TABLE public.booking_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking offers tenant" ON public.booking_offers
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());
CREATE TRIGGER booking_offers_updated
  BEFORE UPDATE ON public.booking_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Idempotent offer generation: one row per (lead, slot).
CREATE UNIQUE INDEX booking_offers_lead_slot_uidx
  ON public.booking_offers (business_id, lead_id, slot_start);
CREATE INDEX booking_offers_lead_idx ON public.booking_offers (lead_id, status);

-- A slot can never be accepted/confirmed twice for the same tenant.
CREATE UNIQUE INDEX booking_offers_taken_slot_uidx
  ON public.booking_offers (business_id, slot_start)
  WHERE status IN ('accepted', 'confirmed');

-- A tenant can never hold two booked jobs at the same time.
CREATE UNIQUE INDEX jobs_scheduled_slot_uidx
  ON public.jobs (business_id, scheduled_at)
  WHERE completion_status = 'scheduled' AND scheduled_at IS NOT NULL;