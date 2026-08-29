-- Real database/RLS regression tests for profiles tenant isolation.
-- Everything runs inside one transaction and is rolled back: no data is kept.
\set ON_ERROR_STOP off
BEGIN;

CREATE TEMP TABLE _t (biz_a uuid, biz_b uuid, user_a uuid, user_b uuid, lead_b uuid) ON COMMIT DROP;
INSERT INTO _t
SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

INSERT INTO public.businesses (id, name, timezone)
SELECT biz_a, 'RLSTEST Tenant A', 'Australia/Sydney' FROM _t;
INSERT INTO public.businesses (id, name, timezone)
SELECT biz_b, 'RLSTEST Tenant B', 'Australia/Sydney' FROM _t;

INSERT INTO public.profiles (id, business_id, name, email)
SELECT user_a, biz_a, 'RLSTEST A', 'a@rlstest.invalid' FROM _t;
INSERT INTO public.profiles (id, business_id, name, email)
SELECT user_b, biz_b, 'RLSTEST B', 'b@rlstest.invalid' FROM _t;

INSERT INTO public.leads (id, business_id, name, mobile_number, source_channel)
SELECT lead_b, biz_b, 'RLSTEST Lead B', '+61400000999', 'manual' FROM _t;

-- Act as tenant A's signed-in user.
CREATE OR REPLACE FUNCTION pg_temp.as_a() RETURNS void LANGUAGE plpgsql AS $$
DECLARE u uuid; BEGIN
  SELECT user_a INTO u FROM _t;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END; $$;

--------------------------------------------------------------------------------
-- TEST 1: tenant A cannot change business_id
--------------------------------------------------------------------------------
SAVEPOINT s1;
SELECT pg_temp.as_a();
UPDATE public.profiles SET business_id = (SELECT biz_b FROM _t) WHERE id = (SELECT user_a FROM _t);
\echo '^ TEST 1 (change business_id) must be a permission error'
ROLLBACK TO SAVEPOINT s1;

--------------------------------------------------------------------------------
-- TEST 2: tenant A cannot change active
--------------------------------------------------------------------------------
SAVEPOINT s2;
SELECT pg_temp.as_a();
UPDATE public.profiles SET active = false WHERE id = (SELECT user_a FROM _t);
\echo '^ TEST 2 (change active) must be a permission error'
ROLLBACK TO SAVEPOINT s2;

--------------------------------------------------------------------------------
-- TEST 3: tenant A CAN update name
--------------------------------------------------------------------------------
SAVEPOINT s3;
SELECT pg_temp.as_a();
UPDATE public.profiles SET name = 'RLSTEST A renamed' WHERE id = (SELECT user_a FROM _t);
SELECT 'TEST 3 name_update_rows=' || count(*)::text AS result
FROM public.profiles WHERE id = (SELECT user_a FROM _t) AND name = 'RLSTEST A renamed';
ROLLBACK TO SAVEPOINT s3;

--------------------------------------------------------------------------------
-- TEST 4: tenant A cannot read tenant B's profile
--------------------------------------------------------------------------------
SAVEPOINT s4;
SELECT pg_temp.as_a();
SELECT 'TEST 4 tenant_b_profiles_visible=' || count(*)::text AS result
FROM public.profiles WHERE email = 'b@rlstest.invalid';
ROLLBACK TO SAVEPOINT s4;

--------------------------------------------------------------------------------
-- TEST 5: tenant scoping still blocks tenant B's business rows (leads)
--------------------------------------------------------------------------------
SAVEPOINT s5;
SELECT pg_temp.as_a();
SELECT 'TEST 5 tenant_b_leads_visible=' || count(*)::text AS result
FROM public.leads WHERE id = (SELECT lead_b FROM _t);
SELECT 'TEST 5 tenant_b_business_visible=' || count(*)::text AS result
FROM public.businesses WHERE id = (SELECT biz_b FROM _t);
ROLLBACK TO SAVEPOINT s5;

--------------------------------------------------------------------------------
-- TEST 6: authorized admin reassignment still works (trusted role path)
--------------------------------------------------------------------------------
SAVEPOINT s6;
SET LOCAL ROLE service_role;
SELECT 'TEST 6 admin_reassigned_to_b=' ||
  ((public.admin_set_profile_assignment((SELECT user_a FROM _t), (SELECT biz_b FROM _t), false)).business_id
   = (SELECT biz_b FROM _t))::text AS result;
RESET ROLE;
SELECT 'TEST 6 profile_business_id_now_b=' ||
  (business_id = (SELECT biz_b FROM _t))::text || ' active=' || active::text AS result
FROM public.profiles WHERE id = (SELECT user_a FROM _t);
SELECT 'TEST 6 audit_events_written=' || count(*)::text AS result
FROM public.audit_events
WHERE event_type = 'profile_assignment_changed' AND entity_id = (SELECT user_a FROM _t);
ROLLBACK TO SAVEPOINT s6;

--------------------------------------------------------------------------------
-- TEST 6b: authenticated users cannot call the admin function directly
--------------------------------------------------------------------------------
SAVEPOINT s6b;
SELECT pg_temp.as_a();
SELECT public.admin_set_profile_assignment((SELECT user_a FROM _t), (SELECT biz_b FROM _t), NULL);
\echo '^ TEST 6b (authenticated calls admin fn) must be a permission error'
ROLLBACK TO SAVEPOINT s6b;

--------------------------------------------------------------------------------
-- TEST 7: signup still creates a profile + role (handle_new_user trigger)
--------------------------------------------------------------------------------
SAVEPOINT s7;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'signup@rlstest.invalid', 'x', now(), now(), '{}'::jsonb, '{"name":"RLSTEST Signup"}'::jsonb);
SELECT 'TEST 7 profile_created=' || count(*)::text AS result
FROM public.profiles WHERE email = 'signup@rlstest.invalid';
SELECT 'TEST 7 role_created=' || count(*)::text AS result
FROM public.user_roles ur
JOIN public.profiles p ON p.id = ur.user_id
WHERE p.email = 'signup@rlstest.invalid';
ROLLBACK TO SAVEPOINT s7;

ROLLBACK;
