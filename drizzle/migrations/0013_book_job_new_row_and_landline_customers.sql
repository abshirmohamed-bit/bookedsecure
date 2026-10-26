DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.assistant_account_action(text,jsonb)'::regprocedure);
  IF position($q$!~ '^\+614[0-9]{8}$'$q$ in d) = 0 THEN RAISE EXCEPTION 'account action text not found'; END IF;
  d := replace(d, $q$!~ '^\+614[0-9]{8}$'$q$, $q$!~ '^\+61[23478][0-9]{8}$'$q$);
  d := replace(d, 'valid Australian mobile number.', 'valid Australian phone number.');
  EXECUTE d;

  d := pg_get_functiondef('public.assistant_operational_action(text,jsonb)'::regprocedure);
  IF position($q$r:=public.schedule_owner_job(b,l,start_at); UPDATE public.jobs SET service_performed=COALESCE(p_input->>'serviceName',service_performed),notes=COALESCE(p_input->>'notes',notes) WHERE id=r AND business_id=b;$q$ in d) = 0 THEN RAISE EXCEPTION 'book_job text not found'; END IF;
  d := replace(d, $q$r:=public.schedule_owner_job(b,l,start_at); UPDATE public.jobs SET service_performed=COALESCE(p_input->>'serviceName',service_performed),notes=COALESCE(p_input->>'notes',notes) WHERE id=r AND business_id=b;$q$,
    $q$BEGIN INSERT INTO public.jobs(business_id,lead_id,scheduled_at,completion_status,service_performed,notes) VALUES(b,l,start_at,'scheduled',p_input->>'serviceName',p_input->>'notes') RETURNING id INTO r; EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That time is already booked. Choose another time.'; END; UPDATE public.leads SET status='scheduled',booking_status='scheduled' WHERE id=l AND business_id=b;$q$);
  d := replace(d, $q$p_input->>'mobile' !~ '^\+614[0-9]{8}$' THEN RAISE EXCEPTION 'Invalid Australian mobile.'$q$, $q$p_input->>'mobile' !~ '^\+61[23478][0-9]{8}$' THEN RAISE EXCEPTION 'Invalid Australian phone number.'$q$);
  EXECUTE d;
END $mig$;