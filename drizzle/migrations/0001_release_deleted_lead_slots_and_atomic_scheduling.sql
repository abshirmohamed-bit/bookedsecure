CREATE OR REPLACE FUNCTION public.release_deleted_lead_bookings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.jobs SET completion_status = 'cancelled'
      WHERE business_id = NEW.business_id AND lead_id = NEW.id AND completion_status = 'scheduled';
    UPDATE public.booking_offers SET status = 'withdrawn'
      WHERE business_id = NEW.business_id AND lead_id = NEW.id AND status IN ('offered', 'accepted', 'confirmed');
    IF NEW.booking_status IN ('scheduled', 'offered', 'accepted') THEN NEW.booking_status := 'cancelled'; END IF;
    IF NEW.status = 'scheduled' THEN NEW.status := 'contacted'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.release_deleted_lead_bookings() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER release_deleted_lead_bookings BEFORE UPDATE OF deleted_at ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.release_deleted_lead_bookings();

CREATE OR REPLACE FUNCTION public.guard_scheduled_job_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted_at timestamptz;
BEGIN
  IF NEW.completion_status = 'scheduled' THEN
    SELECT deleted_at INTO v_deleted_at FROM public.leads
      WHERE id = NEW.lead_id AND business_id = NEW.business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That customer is not in your leads.'; END IF;
    IF v_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This lead has been deleted. Restore it before scheduling a booking.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_scheduled_job_lead() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_scheduled_job_lead BEFORE INSERT OR UPDATE OF scheduled_at, completion_status, lead_id, business_id ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_scheduled_job_lead();

CREATE OR REPLACE FUNCTION public.schedule_owner_job(p_business_id uuid, p_lead_id uuid, p_scheduled_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted_at timestamptz; v_job_id uuid;
BEGIN
  IF p_scheduled_at IS NULL THEN RAISE EXCEPTION 'Choose a valid appointment time.'; END IF;
  SELECT deleted_at INTO v_deleted_at FROM public.leads
    WHERE id = p_lead_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That customer is not in your leads.'; END IF;
  IF v_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This lead has been deleted. Restore it before scheduling a booking.'; END IF;
  SELECT id INTO v_job_id FROM public.jobs
    WHERE business_id = p_business_id AND lead_id = p_lead_id AND completion_status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_job_id IS NULL THEN
    INSERT INTO public.jobs (business_id, lead_id, scheduled_at, completion_status)
    VALUES (p_business_id, p_lead_id, p_scheduled_at, 'scheduled') RETURNING id INTO v_job_id;
  ELSE
    UPDATE public.jobs SET scheduled_at = p_scheduled_at WHERE id = v_job_id AND business_id = p_business_id;
  END IF;
  UPDATE public.leads SET status = 'scheduled', booking_status = 'scheduled'
    WHERE id = p_lead_id AND business_id = p_business_id;
  RETURN v_job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_owner_job(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_owner_job(uuid, uuid, timestamptz) TO service_role;