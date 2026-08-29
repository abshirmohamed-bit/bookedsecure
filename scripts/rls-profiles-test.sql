-- Real database / RLS regression checks for profiles tenant isolation.
-- Run each numbered block as its own statement batch through the Lovable Cloud
-- SQL runner (each batch must be its own transaction so SET LOCAL ROLE applies).
-- Blocks 1, 2 and 6b MUST fail with SQLSTATE 42501 (permission denied).

-- 0. Fixtures ----------------------------------------------------------------
INSERT INTO public.businesses (id, name, timezone) VALUES
  ('a1e5c001-0000-4000-8000-000000000001','RLSTEST Tenant A','Australia/Sydney'),
  ('a1e5c001-0000-4000-8000-000000000002','RLSTEST Tenant B','Australia/Sydney');
INSERT INTO public.profiles (id, business_id, name, email) VALUES
  ('a1e5c001-0000-4000-8000-00000000000a','a1e5c001-0000-4000-8000-000000000001','RLSTEST A','a@rlstest.invalid'),
  ('a1e5c001-0000-4000-8000-00000000000b','a1e5c001-0000-4000-8000-000000000002','RLSTEST B','b@rlstest.invalid');
INSERT INTO public.leads (id, business_id, name, mobile_number, source_channel) VALUES
  ('a1e5c001-0000-4000-8000-00000000000c','a1e5c001-0000-4000-8000-000000000002','RLSTEST Lead B','+61400000999','manual');

-- 1. Tenant A cannot change business_id (expect 42501) -----------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1e5c001-0000-4000-8000-00000000000a","role":"authenticated"}', true);
UPDATE public.profiles SET business_id = 'a1e5c001-0000-4000-8000-000000000002' WHERE id = 'a1e5c001-0000-4000-8000-00000000000a';

-- 2. Tenant A cannot change active (expect 42501) ----------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1e5c001-0000-4000-8000-00000000000a","role":"authenticated"}', true);
UPDATE public.profiles SET active = false WHERE id = 'a1e5c001-0000-4000-8000-00000000000a';

-- 3. Tenant A can update name (expect success) -------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1e5c001-0000-4000-8000-00000000000a","role":"authenticated"}', true);
UPDATE public.profiles SET name = 'RLSTEST A renamed' WHERE id = 'a1e5c001-0000-4000-8000-00000000000a';
SELECT id, name, business_id, active FROM public.profiles WHERE id = 'a1e5c001-0000-4000-8000-00000000000a';

-- 4 + 5. Tenant A cannot read tenant B rows (expect all zeros but own=1) -----
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1e5c001-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT
  (SELECT count(*) FROM public.profiles WHERE email='b@rlstest.invalid') AS tenant_b_profiles_visible,
  (SELECT count(*) FROM public.leads WHERE id='a1e5c001-0000-4000-8000-00000000000c') AS tenant_b_leads_visible,
  (SELECT count(*) FROM public.businesses WHERE id='a1e5c001-0000-4000-8000-000000000002') AS tenant_b_business_visible,
  (SELECT count(*) FROM public.profiles WHERE email='a@rlstest.invalid') AS own_profile_visible;

-- 6. Authorized trusted reassignment still works (expect tenant B id) --------
SET LOCAL ROLE service_role;
SELECT (public.admin_set_profile_assignment('a1e5c001-0000-4000-8000-00000000000a','a1e5c001-0000-4000-8000-000000000002', false)).business_id;

-- 6b. Signed-in users cannot call the admin function (expect 42501) ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a1e5c001-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT public.admin_set_profile_assignment('a1e5c001-0000-4000-8000-00000000000a','a1e5c001-0000-4000-8000-000000000002', NULL);

-- 7. Signup still creates profile + role (expect one profile, role 'staff') --
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('a1e5c001-0000-4000-8000-00000000000f','00000000-0000-0000-0000-000000000000','authenticated','authenticated','signup@rlstest.invalid','x',now(),now(),'{}'::jsonb,'{"name":"RLSTEST Signup"}'::jsonb);
SELECT p.id, p.name, p.email, p.business_id,
       (SELECT role::text FROM public.user_roles ur WHERE ur.user_id = p.id LIMIT 1) AS role
FROM public.profiles p WHERE p.email = 'signup@rlstest.invalid';

-- 8. Cleanup -----------------------------------------------------------------
DELETE FROM auth.users WHERE email='signup@rlstest.invalid';
DELETE FROM public.audit_events WHERE event_type='profile_assignment_changed' AND entity_id='a1e5c001-0000-4000-8000-00000000000a';
DELETE FROM public.leads WHERE id='a1e5c001-0000-4000-8000-00000000000c';
DELETE FROM public.profiles WHERE email IN ('a@rlstest.invalid','b@rlstest.invalid','signup@rlstest.invalid');
DELETE FROM public.businesses WHERE id IN ('a1e5c001-0000-4000-8000-000000000001','a1e5c001-0000-4000-8000-000000000002');
