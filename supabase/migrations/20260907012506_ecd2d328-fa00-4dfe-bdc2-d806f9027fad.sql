ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS service_address text;

DROP VIEW IF EXISTS public.lead_inbox_rows;

CREATE VIEW public.lead_inbox_rows
WITH (security_invoker = on) AS
  SELECT l.id,
     l.business_id,
     l.name,
     l.mobile_number,
     l.email,
     l.service_address,
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