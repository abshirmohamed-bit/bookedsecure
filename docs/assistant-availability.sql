-- Assistant availability action (Co-work, ChatGPT, Claude).
--
-- Lovable: please apply this as one migration. It adds one new function and
-- changes nothing that exists.
--
-- Owner-only, plan-checked (assistant_action_business), tenant from auth.uid(),
-- audited in the same transaction. Times are the business's local wall-clock
-- time, converted with the business timezone here, so callers never do
-- timezone maths.
--
-- p_action:
--   'update'  : any of online_booking, weekly_hours (replaces the list),
--               earliest_booking_minutes, booking_window_days, travel_minutes,
--               start_every_minutes, reminder_hours (0 = off). Null/absent = unchanged.
--   'block'   : date (YYYY-MM-DD), optional until_date, optional from/to (HH:MM;
--               absent = whole day), optional reason.
--   'unblock' : block_id.
CREATE OR REPLACE FUNCTION public.assistant_availability_action(p_action text, p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b uuid;
  tz text;
  patch jsonb;
  w jsonb;
  d_from date;
  d_to date;
  t_from time;
  t_to time;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_reason text;
  result jsonb;
BEGIN
  b := public.assistant_action_business(true, true);
  IF p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN RAISE EXCEPTION 'Availability details are required.'; END IF;
  SELECT timezone INTO tz FROM public.businesses WHERE id = b;
  IF tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'Set the business timezone first.';
  END IF;

  IF p_action = 'update' THEN
    patch := jsonb_strip_nulls(p_input);
    IF patch - ARRAY['online_booking','weekly_hours','earliest_booking_minutes','booking_window_days',
                     'travel_minutes','start_every_minutes','reminder_hours']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported availability settings.';
    END IF;
    IF patch = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing to change.'; END IF;

    IF patch ? 'weekly_hours' THEN
      IF jsonb_typeof(patch->'weekly_hours') <> 'array' OR jsonb_array_length(patch->'weekly_hours') > 21 THEN
        RAISE EXCEPTION 'Working hours must be a list of up to 21 day windows.';
      END IF;
      FOR w IN SELECT * FROM jsonb_array_elements(patch->'weekly_hours') LOOP
        IF (w->>'weekday') !~ '^[0-6]$'
           OR COALESCE(w->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR COALESCE(w->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (w->>'end') <= (w->>'start') THEN
          RAISE EXCEPTION 'Each working window needs a weekday (0 = Sunday) and a start before its end (HH:MM).';
        END IF;
      END LOOP;
    END IF;
    IF (patch ? 'earliest_booking_minutes' AND (patch->>'earliest_booking_minutes')::int NOT BETWEEN 0 AND 10080)
       OR (patch ? 'booking_window_days' AND (patch->>'booking_window_days')::int NOT BETWEEN 1 AND 30)
       OR (patch ? 'travel_minutes' AND (patch->>'travel_minutes')::int NOT BETWEEN 0 AND 240)
       OR (patch ? 'start_every_minutes' AND (patch->>'start_every_minutes')::int NOT BETWEEN 5 AND 240)
       OR (patch ? 'reminder_hours' AND (patch->>'reminder_hours')::int NOT BETWEEN 0 AND 72) THEN
      RAISE EXCEPTION 'A value is out of range: earliest booking 0-10080 minutes, booking window 1-30 days, travel 0-240 minutes, start times every 5-240 minutes, reminder 0-72 hours.';
    END IF;

    INSERT INTO public.booking_availability (business_id) VALUES (b) ON CONFLICT (business_id) DO NOTHING;
    UPDATE public.booking_availability SET
      active = COALESCE((patch->>'online_booking')::boolean, active),
      weekly_windows = COALESCE(patch->'weekly_hours', weekly_windows),
      lead_time_minutes = COALESCE((patch->>'earliest_booking_minutes')::int, lead_time_minutes),
      horizon_days = COALESCE((patch->>'booking_window_days')::int, horizon_days),
      travel_buffer_minutes = COALESCE((patch->>'travel_minutes')::int, travel_buffer_minutes),
      slot_step_minutes = COALESCE((patch->>'start_every_minutes')::int, slot_step_minutes),
      customer_reminder_hours = CASE
        WHEN patch ? 'reminder_hours' THEN NULLIF((patch->>'reminder_hours')::int, 0)
        ELSE customer_reminder_hours END,
      updated_at = now()
    WHERE business_id = b;
    v_id := b;

  ELSIF p_action = 'block' THEN
    IF p_input - ARRAY['date','until_date','from','to','reason']::text[] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported blocked-time fields.';
    END IF;
    IF COALESCE(p_input->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Give the date as YYYY-MM-DD.'; END IF;
    d_from := (p_input->>'date')::date;
    d_to := COALESCE(NULLIF(p_input->>'until_date','')::date, d_from);
    IF d_to < d_from OR d_to > d_from + 90 THEN RAISE EXCEPTION 'Blocked time can cover up to 90 days, ending on or after it starts.'; END IF;
    t_from := COALESCE(NULLIF(p_input->>'from','')::time, '00:00');
    t_to := NULLIF(p_input->>'to','')::time;
    v_start := (d_from + t_from) AT TIME ZONE tz;
    v_end := CASE WHEN t_to IS NULL THEN ((d_to + 1) + time '00:00') AT TIME ZONE tz ELSE (d_to + t_to) AT TIME ZONE tz END;
    IF v_end <= v_start THEN RAISE EXCEPTION 'Blocked time must end after it starts.'; END IF;
    IF v_end < now() THEN RAISE EXCEPTION 'That time has already passed.'; END IF;
    v_reason := left(NULLIF(btrim(p_input->>'reason'), ''), 120);
    INSERT INTO public.booking_blocks (business_id, starts_at, ends_at, reason, created_by)
    VALUES (b, v_start, v_end, v_reason, auth.uid()) RETURNING id INTO v_id;

  ELSIF p_action = 'unblock' THEN
    IF COALESCE(p_input->>'block_id','') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Which blocked time? Read availability first.'; END IF;
    DELETE FROM public.booking_blocks WHERE id = (p_input->>'block_id')::uuid AND business_id = b RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'That blocked time is not in your calendar.'; END IF;

  ELSE
    RAISE EXCEPTION 'This availability action is not enabled.';
  END IF;

  INSERT INTO public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (b, auth.uid(), 'assistant_availability_' || p_action, 'business', v_id,
          jsonb_build_object('client_id', auth.jwt()->>'client_id', 'input', p_input));

  SELECT jsonb_build_object(
    'ok', true,
    'action', p_action,
    'id', v_id,
    'timezone', tz,
    'online_booking', a.active,
    'weekly_hours', a.weekly_windows,
    'earliest_booking_minutes', a.lead_time_minutes,
    'booking_window_days', a.horizon_days,
    'travel_minutes', a.travel_buffer_minutes,
    'start_every_minutes', a.slot_step_minutes,
    'reminder_hours', a.customer_reminder_hours,
    'blocked', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', k.id,
        'from', to_char(k.starts_at AT TIME ZONE tz, 'YYYY-MM-DD HH24:MI'),
        'to', to_char(k.ends_at AT TIME ZONE tz, 'YYYY-MM-DD HH24:MI'),
        'reason', k.reason) ORDER BY k.starts_at)
      FROM public.booking_blocks k WHERE k.business_id = b AND k.ends_at > now()), '[]'::jsonb)
  ) INTO result
  FROM public.booking_availability a WHERE a.business_id = b;
  RETURN COALESCE(result, jsonb_build_object('ok', true, 'action', p_action, 'id', v_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.assistant_availability_action(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_availability_action(text, jsonb) TO authenticated;
