-- Rollback-only: requires a privileged test connection, never a live tenant mutation.
BEGIN;
DO $$
DECLARE u uuid; b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); lead uuid; service uuid; extra uuid; job uuid; foreign_lead uuid; result jsonb; pending jsonb; start_at timestamptz:=now()+interval '365 days';
BEGIN
 SELECT p.id INTO u FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id WHERE p.active AND r.role='owner' LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Owner fixture required.'; END IF;
 INSERT INTO public.businesses(id,name,subscription_status,current_period_end) VALUES(b,'Rollback operational test','trialing',now()+interval '14 days'),(other_b,'Rollback isolation','active',NULL);
 UPDATE public.profiles SET business_id=b WHERE id=u;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','client_id','rollback-client')::text,true);
 result:=public.assistant_account_action('create_customer',jsonb_build_object('name','Rollback customer','mobile','+61400000001'));lead:=(result->>'id')::uuid;
 PERFORM public.assistant_operational_action('update_customer',jsonb_build_object('leadId',lead,'status','previous_lead','notes','Exact note'));
 IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=lead AND status='previous_lead' AND notes='Exact note') THEN RAISE EXCEPTION 'Customer save/readback failed.';END IF;
 INSERT INTO public.leads(business_id,name,mobile_number) VALUES(other_b,'Foreign customer','+61400000002') RETURNING id INTO foreign_lead;
 BEGIN
  PERFORM public.assistant_operational_action('update_customer',jsonb_build_object('leadId',foreign_lead,'notes','Blocked'));
  RAISE EXCEPTION 'Cross-tenant access unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%not found in your business%' THEN RAISE;END IF;END;
 result:=public.assistant_operational_action('book_job',jsonb_build_object('leadId',lead,'startsAt',start_at));job:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=job AND scheduled_at=start_at AND completion_status='scheduled') THEN RAISE EXCEPTION 'Booking save failed.';END IF;
 PERFORM public.assistant_operational_action('reschedule_job',jsonb_build_object('jobId',job,'startsAt',start_at+interval '1 hour'));
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=job AND scheduled_at=start_at+interval '1 hour') THEN RAISE EXCEPTION 'Reschedule failed.';END IF;
 PERFORM public.assistant_operational_action('complete_job',jsonb_build_object('jobId',job,'leadId',lead,'paidAmount',450));
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=job AND completion_status='completed' AND completed_value=450) THEN RAISE EXCEPTION 'Completion amount failed.';END IF;
 PERFORM public.assistant_operational_action('cancel_job',jsonb_build_object('jobId',job));
 IF NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=job AND completion_status='cancelled' AND completed_value IS NULL) THEN RAISE EXCEPTION 'Cancellation failed.';END IF;
 result:=public.assistant_account_action('upsert_service',jsonb_build_object('name','Rollback service','price','from $229'));service:=(result->>'id')::uuid;
 result:=public.assistant_account_action('upsert_addon',jsonb_build_object('name','Rollback extra','price','$50'));extra:=(result->>'id')::uuid;
 PERFORM public.assistant_operational_action('set_addon_availability',jsonb_build_object('addonId',extra,'serviceIds',jsonb_build_array(service),'remove',false));
 IF NOT EXISTS(SELECT 1 FROM public.service_addon_links WHERE business_id=b AND service_id=service AND addon_id=extra) THEN RAISE EXCEPTION 'Tenant add-on link failed.';END IF;
 PERFORM public.assistant_operational_action('bulk_update_lead_status',jsonb_build_object('toStatus','customer_replied','fromStatuses',NULL,'source',NULL,'origin',NULL,'excludeOptedOut',true));
 IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=lead AND status='customer_replied') THEN RAISE EXCEPTION 'Null-filter bulk status failed.';END IF;
 pending:=public.prepare_connected_assistant_request('Read current automation settings. Do not send messages.');
 IF (pending->>'executed')::boolean OR NOT EXISTS(SELECT 1 FROM public.assistant_messages WHERE id=(pending->>'assistant_message_id')::uuid AND done IS NULL AND proposals->0->>'kind'='assistant_request') THEN RAISE EXCEPTION 'Pending confirmation failed.';END IF;
 IF EXISTS(SELECT 1 FROM public.messages WHERE business_id=b) THEN RAISE EXCEPTION 'Unexpected message sent.';END IF;
 IF has_function_privilege('anon','public.assistant_operational_action(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute allowed.';END IF;
END $$;
SELECT 'PASS: customer, tenant isolation, booking/reschedule/completion/cancellation, exact amount, add-on, bulk null filters, pending confirmation, no sends, anonymous denial' AS result;
ROLLBACK;