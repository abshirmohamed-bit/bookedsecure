CREATE OR REPLACE FUNCTION public.assistant_action_business(p_require_plan boolean DEFAULT true,p_require_owner boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; s text; e timestamptz; d timestamptz; a boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to use assistant actions.'; END IF;
 SELECT business_id INTO b FROM public.profiles WHERE id=auth.uid() AND active=true;
 IF b IS NULL THEN RAISE EXCEPTION 'An active business account is required.'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='platform_admin') INTO a;
 IF p_require_owner AND NOT a AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='owner') THEN RAISE EXCEPTION 'Only the business owner can change data through this connection.'; END IF;
 SELECT subscription_status,current_period_end,past_due_since INTO s,e,d FROM public.businesses WHERE id=b;
 IF p_require_plan AND NOT a AND NOT COALESCE(s='active' OR (s IN ('trialing','canceled') AND e>now()) OR (s='past_due' AND (d IS NULL OR d+interval '7 days'>now())),false) THEN RAISE EXCEPTION 'Your trial or subscription has ended. Contact BookedSecure to restore write access.'; END IF;
 RETURN b;
END; $$;
REVOKE ALL ON FUNCTION public.assistant_action_business(boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assistant_action_business(boolean,boolean) TO authenticated;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.assistant_account_action(text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'b:=public.assistant_action_business();','b:=public.assistant_action_business(true, p_action=''update_business_settings'' OR COALESCE(auth.jwt()->>''client_id'','''')<>'''');');
 definition:=replace(definition,'COALESCE($4,60),COALESCE($5,''''General''''),$6','$4,$5,$6');
 EXECUTE definition;
END; $$;