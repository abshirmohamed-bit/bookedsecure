-- Run through the database write tool. The inner block always rolls back.
DO $$
DECLARE
  tenant uuid;
  old_lead uuid := gen_random_uuid();
  new_lead uuid := gen_random_uuid();
  old_job uuid;
  new_job uuid;
  slot timestamptz := '2099-10-20T23:00:00Z';
BEGIN
  BEGIN
    SELECT id INTO tenant FROM public.businesses ORDER BY created_at LIMIT 1;
    IF tenant IS NULL THEN RAISE EXCEPTION 'Test requires a business'; END IF;
    INSERT INTO public.leads (id, business_id, name, mobile_number)
      VALUES (old_lead, tenant, 'Booking regression old', '+61400000000'),
             (new_lead, tenant, 'Booking regression new', '+61400000001');
    old_job := public.schedule_owner_job(tenant, old_lead, slot);
    BEGIN
      PERFORM public.schedule_owner_job(tenant, new_lead, slot);
      RAISE EXCEPTION 'FAIL: duplicate slot was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM public.jobs WHERE lead_id = new_lead) OR
       EXISTS (SELECT 1 FROM public.leads WHERE id = new_lead AND status = 'scheduled') THEN
      RAISE EXCEPTION 'FAIL: failed scheduling changed job or lead state';
    END IF;
    INSERT INTO public.booking_offers (business_id, lead_id, slot_start, slot_end, timezone, status)
      VALUES (tenant, old_lead, slot, slot + interval '1 hour', 'Australia/Sydney', 'confirmed');
    UPDATE public.leads SET deleted_at = now() WHERE id = old_lead;
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = old_job AND completion_status = 'cancelled') THEN
      RAISE EXCEPTION 'FAIL: deleted lead still occupies slot';
    END IF;
    IF EXISTS (SELECT 1 FROM public.booking_offers WHERE lead_id = old_lead AND status = 'confirmed') THEN
      RAISE EXCEPTION 'FAIL: deleted lead offer still occupies slot';
    END IF;
    new_job := public.schedule_owner_job(tenant, new_lead, slot);
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = new_job AND scheduled_at = slot AND completion_status = 'scheduled') THEN
      RAISE EXCEPTION 'FAIL: replacement booking did not save at exactly 10 AM Sydney';
    END IF;
    UPDATE public.leads SET deleted_at = NULL WHERE id = old_lead;
    IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = old_job AND completion_status = 'cancelled') THEN
      RAISE EXCEPTION 'FAIL: restoring lead reactivated old booking';
    END IF;
    UPDATE public.leads SET deleted_at = now() WHERE id = old_lead;
    BEGIN
      PERFORM public.schedule_owner_job(tenant, old_lead, slot + interval '2 hours');
      RAISE EXCEPTION 'FAIL: deleted lead could be scheduled';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'This lead has been deleted.%' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'PASS; roll back test records';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$$;