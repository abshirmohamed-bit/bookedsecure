CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_business uuid;
  invited_business uuid;
  display_name text;
  business_label text;
  is_owner boolean := true;
BEGIN
  display_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1));

  BEGIN
    invited_business := NULLIF(TRIM(NEW.raw_user_meta_data->>'business_id'), '')::uuid;
  EXCEPTION WHEN others THEN
    invited_business := NULL;
  END;

  IF invited_business IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.businesses WHERE id = invited_business) THEN
    target_business := invited_business;
    is_owner := false;
  ELSE
    business_label := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'business_name'), ''),
      NULLIF(display_name, ''),
      'New business'
    );
    INSERT INTO public.businesses (name, automation_enabled, quote_form_active)
    VALUES (business_label, false, true)
    RETURNING id INTO target_business;
  END IF;

  INSERT INTO public.profiles (id, business_id, name, email)
  VALUES (NEW.id, target_business, display_name, NEW.email);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_owner THEN 'owner'::public.app_role ELSE 'staff'::public.app_role END);

  RETURN NEW;
END;
$function$;