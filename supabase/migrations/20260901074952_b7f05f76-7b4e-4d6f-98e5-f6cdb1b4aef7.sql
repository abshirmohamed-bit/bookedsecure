ALTER TABLE public.lead_deletion_requests
  DROP CONSTRAINT lead_deletion_requests_action_check;

ALTER TABLE public.lead_deletion_requests
  ADD CONSTRAINT lead_deletion_requests_action_check
  CHECK (action = ANY (ARRAY['soft_delete'::text, 'restore'::text, 'permanent_delete'::text]));