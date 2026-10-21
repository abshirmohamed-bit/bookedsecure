-- Rollback-only integration checks. No provider calls or persistent test data.
BEGIN;
DO $$
DECLARE u uuid; b uuid := gen_random_uuid(); other_b uuid := gen_random_uuid();
 lead uuid; foreign_service uuid; service uuid; extra uuid; result jsonb; second jsonb; before_count bigint;
BEGIN
 SELECT p.id INTO u FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id WHERE r.role='owner' AND p.active=true LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Integration test needs an existing owner fixture.'; END IF;
 INSERT INTO public.businesses(id,name,subscription_status,current_period_end) VALUES(b,'Rollback assistant test','trialing',now()+interval '14 days'),(other_b,'Rollback isolation test','active',NULL);
 UPDATE public.profiles SET business_id=b WHERE id=u;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','client_id','rollback-test-client')::text,true);
 result:=public.assistant_account_action('create_customer',jsonb_build_object('name','Rollback Sarah','mobile','+61412345678'));
 lead:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=lead AND business_id=b AND opted_out_at IS NULL) THEN RAISE EXCEPTION 'Customer creation/readback failed.'; END IF;
 result:=public.assistant_account_action('upsert_service',jsonb_build_object('name','Rollback detail','price','from $229'));
 service:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.services WHERE id=service AND business_id=b AND price_guidance='from $229' AND duration_minutes IS NULL AND category IS NULL) THEN RAISE EXCEPTION 'Exact price and unset duration were not preserved.'; END IF;
 PERFORM public.assistant_account_action('upsert_service',jsonb_build_object('serviceId',service,'price','$250','active',false));
 IF NOT EXISTS(SELECT 1 FROM public.services WHERE id=service AND name='Rollback detail' AND price_guidance='$250' AND active=false) THEN RAISE EXCEPTION 'Service update/readback failed.'; END IF;
 result:=public.assistant_account_action('upsert_addon',jsonb_build_object('name','Rollback extra','price','$40'));
 extra:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.service_addons WHERE id=extra AND business_id=b AND price_guidance='$40') THEN RAISE EXCEPTION 'Add-on creation failed.'; END IF;
 PERFORM public.assistant_account_action('update_business_settings',jsonb_build_object('service_area','Sydney test area'));
 IF NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=b AND service_area='Sydney test area') THEN RAISE EXCEPTION 'Service-area update/readback failed.'; END IF;
 INSERT INTO public.services(business_id,name) VALUES(other_b,'Other tenant service') RETURNING id INTO foreign_service;
 BEGIN
  PERFORM public.assistant_account_action('upsert_service',jsonb_build_object('serviceId',foreign_service,'price','$1'));
  RAISE EXCEPTION 'Cross-tenant mutation unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%does not belong%' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO before_count FROM public.messages WHERE business_id=b;
 result:=public.mcp_prepare_assistant_text(lead,'Thanks Sarah, your enquiry has been received.');
 second:=public.mcp_prepare_assistant_text(lead,'Thanks Sarah, your enquiry has been received.');
 IF (result->>'sent')::boolean IS DISTINCT FROM false OR result->>'assistant_message_id' IS DISTINCT FROM second->>'assistant_message_id' THEN RAISE EXCEPTION 'Approval/deduplication failed.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.assistant_messages WHERE id=(result->>'assistant_message_id')::uuid AND business_id=b AND done IS NULL AND proposals->0->>'kind'='send_text' AND proposals->0->>'message'='Thanks Sarah, your enquiry has been received.') THEN RAISE EXCEPTION 'Approval is not readable in Cowork.'; END IF;
 IF (SELECT count(*) FROM public.messages WHERE business_id=b)<>before_count THEN RAISE EXCEPTION 'Text preparation unexpectedly sent a message.'; END IF;
 UPDATE public.leads SET opted_out_at=now() WHERE id=lead;
 BEGIN
  PERFORM public.mcp_prepare_assistant_text(lead,'Another message');
  RAISE EXCEPTION 'Opt-out unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%cannot receive%' THEN RAISE; END IF; END;
 UPDATE public.leads SET opted_out_at=NULL,deleted_at=now() WHERE id=lead;
 BEGIN
  PERFORM public.mcp_prepare_assistant_text(lead,'Another message');
  RAISE EXCEPTION 'Deleted lead unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%not found%' THEN RAISE; END IF; END;
 UPDATE public.businesses SET subscription_status='trialing',current_period_end=now()-interval '1 day' WHERE id=b;
 DELETE FROM public.user_roles WHERE user_id=u AND role='platform_admin';
 BEGIN
  PERFORM public.assistant_account_action('update_business_settings','{"service_area":"Blocked"}'::jsonb);
  RAISE EXCEPTION 'Expired trial unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%trial or subscription has ended%' THEN RAISE; END IF; END;
 UPDATE public.businesses SET subscription_status='active' WHERE id=b;
 DELETE FROM public.user_roles WHERE user_id=u AND role='owner';
 BEGIN
  PERFORM public.assistant_account_action('upsert_service',jsonb_build_object('serviceId',service,'price','$1'));
  RAISE EXCEPTION 'External staff write unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%Only the business owner%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM public.assistant_account_action('upsert_service',jsonb_build_object('serviceId',service,'price','$260'));
 IF NOT EXISTS(SELECT 1 FROM public.services WHERE id=service AND price_guidance='$260') THEN RAISE EXCEPTION 'Existing Cowork staff catalog access regressed.'; END IF;
 IF has_function_privilege('anon','public.assistant_account_action(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous writes unexpectedly granted.'; END IF;
END;
$$;
SELECT 'PASS: customer, service/add-on, service area, tenant isolation, pending text/readback, retry deduplication, no SMS sent, opt-out/deleted-lead rejection, expired trial, external staff rejection and existing Cowork staff access' AS result;
ROLLBACK;