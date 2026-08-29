UPDATE public.businesses SET automation_enabled = false, updated_at = now() WHERE id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.audit_events (business_id, event_type, entity_type, entity_id, metadata)
VALUES ('11111111-1111-1111-1111-111111111111', 'automation_disabled', 'business', '11111111-1111-1111-1111-111111111111',
  jsonb_build_object('reason', 'operator instruction - security review of profiles_business_id_escalation', 'previous_value', true, 'new_value', false));