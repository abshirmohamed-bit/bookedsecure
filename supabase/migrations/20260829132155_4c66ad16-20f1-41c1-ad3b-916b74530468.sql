-- 1. Remove blanket write privileges on profiles from client roles
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.profiles FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.profiles FROM anon;

-- 2. Re-grant the minimum: read (RLS-scoped) + update of the display name only
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;

-- 3. Trusted server/admin path keeps full privileges (no trigger, so admin
--    reassignment is never blocked).
GRANT ALL ON public.profiles TO service_role;

-- 4. Tighten the RLS update policy so a row can only ever be updated by its owner
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 5. Dedicated trusted reassignment mechanism: security-definer function usable
--    only by platform admins (via has_role) or trusted backend roles.
CREATE OR REPLACE FUNCTION public.admin_set_profile_assignment(
  p_profile_id uuid,
  p_business_id uuid,
  p_active boolean DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.profiles;
  caller uuid := auth.uid();
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF caller IS NULL OR NOT public.has_role(caller, 'platform_admin'::public.app_role) THEN
      RAISE EXCEPTION 'not authorized to reassign profiles';
    END IF;
  END IF;

  UPDATE public.profiles
  SET business_id = p_business_id,
      active = COALESCE(p_active, active)
  WHERE id = p_profile_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'profile % not found', p_profile_id;
  END IF;

  INSERT INTO public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    p_business_id,
    caller,
    'profile_assignment_changed',
    'profile',
    p_profile_id,
    jsonb_build_object('business_id', p_business_id, 'active', result.active, 'actor', caller, 'db_role', current_user)
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_assignment(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_assignment(uuid, uuid, boolean) TO authenticated, service_role;