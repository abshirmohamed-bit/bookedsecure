ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS reachability_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS reachability_evidence text,
  ADD COLUMN IF NOT EXISTS reachability_evidence_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_permanent_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_reply_at timestamptz;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_reachability_state_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_reachability_state_check
  CHECK (reachability_state IN ('unknown','reachable_recently','unreachable_recently','suppressed_pending_review'));

UPDATE public.leads SET
  last_successful_delivery_at = COALESCE(last_successful_delivery_at, last_delivered_sms_at),
  last_inbound_reply_at = COALESCE(last_inbound_reply_at, last_reply_at, first_reply_at),
  last_permanent_failure_at = COALESCE(
    last_permanent_failure_at,
    CASE WHEN sms_suppressed_at IS NOT NULL THEN COALESCE(last_sms_failure_at, sms_suppressed_at) END
  );

UPDATE public.leads SET
  reachability_state = CASE
    WHEN GREATEST(COALESCE(last_successful_delivery_at, '-infinity'::timestamptz),
                  COALESCE(last_inbound_reply_at, '-infinity'::timestamptz))
         > COALESCE(last_permanent_failure_at, '-infinity'::timestamptz)
      AND (last_successful_delivery_at IS NOT NULL OR last_inbound_reply_at IS NOT NULL)
      THEN 'reachable_recently'
    WHEN sms_suppressed_at IS NOT NULL THEN 'suppressed_pending_review'
    ELSE 'unknown'
  END,
  reachability_evidence = CASE
    WHEN GREATEST(COALESCE(last_successful_delivery_at, '-infinity'::timestamptz),
                  COALESCE(last_inbound_reply_at, '-infinity'::timestamptz))
         > COALESCE(last_permanent_failure_at, '-infinity'::timestamptz)
      AND (last_successful_delivery_at IS NOT NULL OR last_inbound_reply_at IS NOT NULL)
      THEN CASE
        WHEN COALESCE(last_inbound_reply_at, '-infinity'::timestamptz) >= COALESCE(last_successful_delivery_at, '-infinity'::timestamptz)
          THEN 'Customer replied by SMS.'
        ELSE 'Provider confirmed delivery to this number.'
      END
    WHEN sms_suppressed_at IS NOT NULL
      THEN COALESCE(last_sms_failure_reason, 'Permanent delivery failure reported by the provider.') || ' Awaiting review — the number is not proven inactive.'
    ELSE NULL
  END,
  reachability_evidence_at = GREATEST(
    COALESCE(last_successful_delivery_at, '-infinity'::timestamptz),
    COALESCE(last_inbound_reply_at, '-infinity'::timestamptz),
    COALESCE(last_permanent_failure_at, '-infinity'::timestamptz),
    COALESCE(sms_suppressed_at, '-infinity'::timestamptz)
  );

UPDATE public.leads SET reachability_evidence_at = NULL WHERE reachability_evidence_at = '-infinity'::timestamptz;

DROP VIEW IF EXISTS public.lead_inbox_rows;

CREATE VIEW public.lead_inbox_rows
WITH (security_invoker = on) AS
  SELECT l.id,
     l.business_id,
     l.name,
     l.mobile_number,
     l.email,
     l.suburb,
     l.vehicle_type,
     l.service_intent,
     l.source_channel,
     l.source_campaign,
     l.lead_origin,
     l.source_metadata,
     l.import_batch_id,
     l.status,
     l.readiness_classification,
     l.created_at,
     l.updated_at,
     l.first_contacted_at,
     l.first_reply_at,
     l.deleted_at,
     l.deleted_by,
     l.deletion_reason,
     l.deletion_request_id,
     l.last_outbound_sms_status,
     l.last_outbound_sms_at,
     l.last_delivered_sms_at,
     l.last_sms_failure_at,
     l.last_sms_failure_reason,
     l.last_sms_failure_code,
     l.sms_suppressed_at,
     l.sms_suppression_reason,
     l.last_reply_at,
     l.reachability_state,
     l.reachability_evidence,
     l.reachability_evidence_at,
     l.last_successful_delivery_at,
     l.last_permanent_failure_at,
     l.last_inbound_reply_at,
     c.id AS conversation_id,
     c.status AS conversation_status,
     c.next_follow_up_at AS conversation_next_follow_up_at,
     c.automation_paused AS conversation_automation_paused,
     c.last_message_at AS conversation_last_message_at,
     j.id AS job_id,
     j.completion_status AS job_completion_status,
     j.completed_value AS job_completed_value,
     COALESCE(c.last_message_at, l.created_at) AS last_activity_at
    FROM public.leads l
      LEFT JOIN LATERAL ( SELECT cv.id, cv.status, cv.next_follow_up_at, cv.automation_paused, cv.last_message_at
            FROM public.conversations cv
           WHERE cv.lead_id = l.id AND cv.business_id = l.business_id
           ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC
          LIMIT 1) c ON true
      LEFT JOIN LATERAL ( SELECT jb.id, jb.completion_status, jb.completed_value
            FROM public.jobs jb
           WHERE jb.lead_id = l.id AND jb.business_id = l.business_id
           ORDER BY jb.completed_at DESC NULLS LAST, jb.created_at DESC
          LIMIT 1) j ON true;

GRANT SELECT ON public.lead_inbox_rows TO authenticated;
GRANT ALL ON public.lead_inbox_rows TO service_role;