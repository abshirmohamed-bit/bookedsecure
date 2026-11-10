-- Booking API (website quote, availability and booking).
--
-- Lovable: please apply this as one migration. It only adds columns, one table
-- and one function; nothing existing is changed or removed.
--
-- 1. Availability settings: travel buffer between jobs, how often start times
--    are offered, and the customer reminder (off unless the owner sets hours).
ALTER TABLE public.booking_availability
  ADD COLUMN IF NOT EXISTS travel_buffer_minutes integer NOT NULL DEFAULT 0
    CHECK (travel_buffer_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS slot_step_minutes integer NOT NULL DEFAULT 30
    CHECK (slot_step_minutes BETWEEN 5 AND 240),
  ADD COLUMN IF NOT EXISTS customer_reminder_hours integer
    CHECK (customer_reminder_hours IS NULL OR customer_reminder_hours BETWEEN 1 AND 72);

-- 2. Price and length by size, per service. A JSON list such as
--    [{"key":"small","label":"Small car","price":229,"duration_minutes":180}].
--    Empty means the service has one price and length.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS size_options jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. What each booking holds, so later availability checks know its real length.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS duration_minutes integer
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 1440),
  ADD COLUMN IF NOT EXISTS quoted_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS booking_details jsonb,
  ADD COLUMN IF NOT EXISTS booking_request_key text,
  ADD COLUMN IF NOT EXISTS customer_reminder_sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_booking_request_key_idx
  ON public.jobs (business_id, booking_request_key)
  WHERE booking_request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_reminder_due_idx
  ON public.jobs (scheduled_at)
  WHERE completion_status = 'scheduled' AND customer_reminder_sent_at IS NULL;

-- 4. Blocked time (holidays, personal time, a day off). Owner-managed.
CREATE TABLE IF NOT EXISTS public.booking_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS booking_blocks_business_idx ON public.booking_blocks (business_id, starts_at);
GRANT SELECT ON public.booking_blocks TO authenticated;
GRANT ALL ON public.booking_blocks TO service_role;
ALTER TABLE public.booking_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business members view their blocked time" ON public.booking_blocks
  FOR SELECT TO authenticated USING (business_id = private.current_business_id());

-- 5. One atomic booking: lock the business's schedule, replay a repeated
--    request, refuse any overlap (jobs, held chat offers, blocked time, with the
--    travel buffer either side), find or create the customer by mobile, then
--    save the job and a confirmed offer row (which drives the confirmation SMS).
--    Called only by the server with the service role.
CREATE OR REPLACE FUNCTION public.api_book_appointment(
  p_business_id uuid,
  p_request_key text,
  p_customer jsonb,
  p_booking jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := (p_booking->>'starts_at')::timestamptz;
  v_minutes integer := (p_booking->>'duration_minutes')::integer;
  v_buffer integer := COALESCE((p_booking->>'buffer_minutes')::integer, 0);
  v_end timestamptz;
  v_mobile text := p_customer->>'mobile';
  v_job public.jobs;
  v_lead_id uuid;
  v_job_id uuid;
  v_offer_id uuid;
  v_clash integer;
BEGIN
  IF p_request_key IS NULL OR length(p_request_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_request_key');
  END IF;
  IF v_start IS NULL OR v_minutes IS NULL OR v_minutes <= 0 OR v_mobile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_booking');
  END IF;
  v_end := v_start + make_interval(mins => v_minutes);

  -- Serialise bookings per business so two requests can't both take a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('api_book:' || p_business_id::text, 0));

  SELECT * INTO v_job FROM public.jobs
   WHERE business_id = p_business_id AND booking_request_key = p_request_key;
  IF v_job.id IS NOT NULL THEN
    SELECT id INTO v_offer_id FROM public.booking_offers
     WHERE business_id = p_business_id AND job_id = v_job.id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'job_id', v_job.id, 'lead_id', v_job.lead_id,
      'offer_id', v_offer_id, 'starts_at', v_job.scheduled_at);
  END IF;

  SELECT count(*) INTO v_clash
    FROM public.jobs j
    LEFT JOIN public.services s ON s.id = j.service_id AND s.business_id = j.business_id
   WHERE j.business_id = p_business_id
     AND j.completion_status = 'scheduled'
     AND j.scheduled_at IS NOT NULL
     AND j.scheduled_at < v_end + make_interval(mins => v_buffer)
     AND j.scheduled_at + make_interval(mins => COALESCE(j.duration_minutes, s.duration_minutes, 120) + v_buffer) > v_start;
  IF v_clash > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'slot_unavailable'); END IF;

  SELECT count(*) INTO v_clash
    FROM public.booking_offers o
   WHERE o.business_id = p_business_id
     AND o.status IN ('accepted', 'confirmed')
     AND o.job_id IS NULL
     AND o.slot_start < v_end + make_interval(mins => v_buffer)
     AND o.slot_end + make_interval(mins => v_buffer) > v_start;
  IF v_clash > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'slot_unavailable'); END IF;

  SELECT count(*) INTO v_clash
    FROM public.booking_blocks b
   WHERE b.business_id = p_business_id AND b.starts_at < v_end AND b.ends_at > v_start;
  IF v_clash > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'slot_unavailable'); END IF;

  SELECT id INTO v_lead_id FROM public.leads
   WHERE business_id = p_business_id AND mobile_number = v_mobile AND deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (business_id, name, mobile_number, email, suburb, service_address, vehicle_type,
      service_intent, service_name_snapshot, approved_service_id, main_concerns, source_channel, source_form,
      utm_source, status, booking_status, customer_status, consent_status, consent_source, consent_record, source_metadata)
    VALUES (p_business_id, p_customer->>'name', v_mobile, NULLIF(p_customer->>'email', ''), p_customer->>'suburb',
      p_customer->>'address', p_customer->>'vehicle', p_booking->>'service_name', p_booking->>'service_name',
      (p_booking->>'service_id')::uuid, p_customer->>'notes', 'website', 'Website booking', 'API',
      'scheduled', 'scheduled', 'prospect',
      COALESCE(p_customer->>'consent_status', 'unknown'), p_customer->>'consent_source',
      p_customer->'consent_record', p_customer->'source_metadata')
    RETURNING id INTO v_lead_id;
  ELSE
    UPDATE public.leads
       SET status = 'scheduled', booking_status = 'scheduled',
           customer_status = CASE WHEN customer_status = 'previous_customer' THEN customer_status ELSE 'prospect' END,
           email = COALESCE(email, NULLIF(p_customer->>'email', '')),
           suburb = COALESCE(suburb, p_customer->>'suburb'),
           service_address = COALESCE(service_address, p_customer->>'address'),
           vehicle_type = COALESCE(vehicle_type, p_customer->>'vehicle'),
           service_name_snapshot = p_booking->>'service_name',
           approved_service_id = (p_booking->>'service_id')::uuid,
           consent_status = CASE WHEN consent_status = 'unknown' AND p_customer->>'consent_status' = 'granted'
                                 THEN 'granted' ELSE consent_status END,
           consent_source = CASE WHEN consent_status = 'unknown' AND p_customer->>'consent_status' = 'granted'
                                 THEN p_customer->>'consent_source' ELSE consent_source END
     WHERE id = v_lead_id AND business_id = p_business_id;
  END IF;

  INSERT INTO public.jobs (business_id, lead_id, service_id, service_performed, scheduled_at, completion_status,
    duration_minutes, quoted_price, booking_details, booking_request_key, notes)
  VALUES (p_business_id, v_lead_id, (p_booking->>'service_id')::uuid, p_booking->>'service_label', v_start, 'scheduled',
    v_minutes, NULLIF(p_booking->>'price', '')::numeric, p_booking->'details', p_request_key, p_customer->>'notes')
  RETURNING id INTO v_job_id;

  -- A confirmed offer whose job was later cancelled or moved still holds its
  -- start time in booking_offers_taken_slot_uidx; release it first.
  UPDATE public.booking_offers o
     SET status = 'withdrawn'
   WHERE o.business_id = p_business_id
     AND o.slot_start = v_start
     AND o.status IN ('accepted', 'confirmed')
     AND (o.job_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.jobs j
        WHERE j.id = o.job_id AND j.completion_status = 'scheduled' AND j.scheduled_at = o.slot_start));

  INSERT INTO public.booking_offers (business_id, lead_id, service_id, service_name_snapshot, slot_start, slot_end,
    timezone, status, expires_at, accepted_at, confirmed_at, job_id)
  VALUES (p_business_id, v_lead_id, (p_booking->>'service_id')::uuid, p_booking->>'service_label', v_start, v_end,
    COALESCE(p_booking->>'timezone', 'Australia/Sydney'), 'confirmed', now(), now(), now(), v_job_id)
  ON CONFLICT (business_id, lead_id, slot_start) DO UPDATE
    SET status = 'confirmed', service_id = EXCLUDED.service_id, service_name_snapshot = EXCLUDED.service_name_snapshot,
        slot_end = EXCLUDED.slot_end, confirmed_at = now(), accepted_at = now(), job_id = EXCLUDED.job_id
  RETURNING id INTO v_offer_id;

  INSERT INTO public.audit_events (business_id, event_type, entity_type, entity_id, metadata)
  VALUES (p_business_id, 'api_booking_created', 'job', v_job_id,
    jsonb_build_object('lead_id', v_lead_id, 'starts_at', v_start, 'duration_minutes', v_minutes,
      'api_key_id', p_booking->>'api_key_id'));

  RETURN jsonb_build_object('ok', true, 'replay', false, 'job_id', v_job_id, 'lead_id', v_lead_id,
    'offer_id', v_offer_id, 'starts_at', v_start);
END;
$function$;
REVOKE ALL ON FUNCTION public.api_book_appointment(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_book_appointment(uuid, text, jsonb, jsonb) TO service_role;
