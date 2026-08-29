-- Release segments that were reserved but never accepted by the carrier.
CREATE OR REPLACE FUNCTION public.release_sms_segments(p_period_id uuid, p_segments integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.sms_usage_periods
  SET segments_used = GREATEST(segments_used - p_segments, 0),
      updated_at = now()
  WHERE id = p_period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_sms_segments(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_sms_segments(uuid, integer) TO service_role;

ALTER TABLE public.sms_usage_periods
  ADD CONSTRAINT sms_usage_periods_used_nonnegative CHECK (segments_used >= 0),
  ADD CONSTRAINT sms_usage_periods_blocked_nonnegative CHECK (segments_blocked >= 0);