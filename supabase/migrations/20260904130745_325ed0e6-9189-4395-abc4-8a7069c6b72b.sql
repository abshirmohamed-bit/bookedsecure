CREATE OR REPLACE FUNCTION public.commit_web_chat_booking(p_business_id uuid, p_lead_id uuid, p_offer_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offer public.booking_offers;
  v_job_id uuid;
  v_taken integer;
BEGIN
  SELECT * INTO v_offer
  FROM public.booking_offers
  WHERE id = p_offer_id
    AND business_id = p_business_id
    AND lead_id = p_lead_id
  FOR UPDATE;

  IF v_offer.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_not_found');
  END IF;

  IF v_offer.status = 'confirmed' AND v_offer.job_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'scheduled',
           booking_status = 'scheduled',
           customer_status = CASE
             WHEN customer_status = 'previous_customer' THEN customer_status
             ELSE 'prospect'
           END
     WHERE id = p_lead_id
       AND business_id = p_business_id
       AND (status <> 'scheduled' OR booking_status <> 'scheduled' OR customer_status = 'unknown');

    RETURN jsonb_build_object(
      'ok', true, 'replay', true, 'offer_id', v_offer.id,
      'job_id', v_offer.job_id, 'slot_start', v_offer.slot_start
    );
  END IF;

  IF v_offer.status NOT IN ('offered', 'accepted') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_closed');
  END IF;

  IF v_offer.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_expired');
  END IF;

  SELECT count(*) INTO v_taken
  FROM public.booking_offers o
  WHERE o.business_id = p_business_id
    AND o.slot_start = v_offer.slot_start
    AND o.status IN ('accepted', 'confirmed')
    AND o.id <> v_offer.id;
  IF v_taken > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_unavailable');
  END IF;

  SELECT count(*) INTO v_taken
  FROM public.jobs j
  WHERE j.business_id = p_business_id
    AND j.completion_status = 'scheduled'
    AND j.scheduled_at = v_offer.slot_start
    AND j.lead_id <> p_lead_id;
  IF v_taken > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_unavailable');
  END IF;

  UPDATE public.booking_offers
     SET status = 'accepted', accepted_at = COALESCE(accepted_at, now())
   WHERE id = v_offer.id;

  SELECT id INTO v_job_id
  FROM public.jobs
  WHERE business_id = p_business_id AND lead_id = p_lead_id
  LIMIT 1;

  IF v_job_id IS NULL THEN
    INSERT INTO public.jobs (business_id, lead_id, service_id, scheduled_at, completion_status, notes)
    VALUES (p_business_id, p_lead_id, v_offer.service_id, v_offer.slot_start, 'scheduled', p_idempotency_key)
    RETURNING id INTO v_job_id;
  ELSE
    UPDATE public.jobs
       SET scheduled_at = v_offer.slot_start,
           service_id = v_offer.service_id,
           completion_status = 'scheduled'
     WHERE id = v_job_id;
  END IF;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'booking job could not be created for lead %', p_lead_id;
  END IF;

  UPDATE public.booking_offers
     SET status = 'confirmed', confirmed_at = now(), job_id = v_job_id
   WHERE id = v_offer.id;

  UPDATE public.booking_offers
     SET status = 'withdrawn'
   WHERE business_id = p_business_id
     AND lead_id = p_lead_id
     AND status = 'offered'
     AND id <> v_offer.id;

  UPDATE public.leads
     SET status = 'scheduled',
         booking_status = 'scheduled',
         customer_status = CASE
           WHEN customer_status = 'previous_customer' THEN customer_status
           ELSE 'prospect'
         END
   WHERE id = p_lead_id AND business_id = p_business_id;

  RETURN jsonb_build_object(
    'ok', true, 'replay', false, 'offer_id', v_offer.id,
    'job_id', v_job_id, 'slot_start', v_offer.slot_start
  );
END;
$function$;