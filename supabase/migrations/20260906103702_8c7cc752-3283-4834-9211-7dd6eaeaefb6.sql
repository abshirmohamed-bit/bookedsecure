INSERT INTO public.businesses (
  id, name, timezone, service_area, slug, quote_mode, quote_form_active,
  flexible_requests_enabled, agent_enabled, automation_enabled, status
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Canary Detailing (TEST)',
  'Australia/Sydney',
  'Auburn, Lidcombe, Granville, Parramatta',
  'canary-test',
  'ai_chat',
  true,
  true,
  false,
  false,
  'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.services (id, business_id, name, active, duration_minutes)
VALUES
  ('22222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Interior Detail', true, 90),
  ('22222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Exterior Detail', true, 60),
  ('22222222-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Full Detail', true, 150)
ON CONFLICT (id) DO NOTHING;