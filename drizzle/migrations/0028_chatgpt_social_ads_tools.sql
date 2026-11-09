-- ChatGPT (MCP) access to the features added in November 2026: Facebook and
-- Instagram comments and DMs, Facebook ad spend, and the Facebook lead import
-- schedule. Every function derives the business from auth.uid(); none accept a
-- business id. Writes require the OAuth owner (mcp_write_business), are audited
-- in the same transaction, and never post or send anything to Facebook: they
-- only prepare a reply the owner approves inside BookedSecure.

-- Read helper: the caller's active business (any active member, no plan check).
CREATE OR REPLACE FUNCTION public.mcp_read_business() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to read business data.'; END IF;
 SELECT business_id INTO v_business FROM public.profiles WHERE id = auth.uid() AND active = true;
 IF v_business IS NULL THEN RAISE EXCEPTION 'An active business account is required.'; END IF;
 RETURN v_business;
END; $$;
REVOKE ALL ON FUNCTION public.mcp_read_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_read_business() TO authenticated;

-- Facebook/Instagram DM conversations, newest first (one row per customer).
CREATE OR REPLACE FUNCTION public.mcp_social_conversations(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_rows jsonb; v_total integer;
BEGIN
 v_business := public.mcp_read_business();
 IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN RAISE EXCEPTION 'Use a limit of 1-50 and an offset of 0-10000.'; END IF;
 SELECT count(*) INTO v_total FROM (SELECT DISTINCT platform, participant_id FROM public.social_messages WHERE business_id = v_business) c;
 SELECT COALESCE(jsonb_agg(t ORDER BY t->>'last_message_at' DESC), '[]'::jsonb) INTO v_rows FROM (
   SELECT jsonb_build_object(
     'platform', l.platform, 'participant_id', l.participant_id, 'customer_name', n.name,
     'last_message', left(l.body, 300), 'last_message_from', CASE WHEN l.direction = 'in' THEN 'customer' ELSE 'business' END,
     'last_message_at', l.sent_at, 'awaiting_reply', l.direction = 'in',
     'last_customer_message_at', (SELECT max(sent_at) FROM public.social_messages m WHERE m.business_id = v_business AND m.platform = l.platform AND m.participant_id = l.participant_id AND m.direction = 'in'),
     'has_suggested_reply', COALESCE(i.has_suggested_reply, false)
   ) AS t
   FROM (
     SELECT DISTINCT ON (platform, participant_id) platform, participant_id, direction, body, sent_at
     FROM public.social_messages WHERE business_id = v_business
     ORDER BY platform, participant_id, sent_at DESC
   ) l
   LEFT JOIN (SELECT platform, participant_id, bool_or(draft_reply IS NOT NULL AND direction = 'in') AS has_suggested_reply FROM public.social_messages WHERE business_id = v_business GROUP BY platform, participant_id) i USING (platform, participant_id)
   LEFT JOIN (SELECT platform, participant_id, max(participant_name) FILTER (WHERE participant_name IS NOT NULL) AS name FROM public.social_messages WHERE business_id = v_business GROUP BY platform, participant_id) n USING (platform, participant_id)
   ORDER BY l.sent_at DESC
   LIMIT p_limit OFFSET p_offset
 ) s;
 RETURN jsonb_build_object('conversations', v_rows, 'total', v_total, 'next_offset', CASE WHEN p_offset + p_limit < v_total THEN p_offset + p_limit ELSE NULL END);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_social_conversations(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_social_conversations(integer, integer) TO authenticated;

-- One DM conversation: the last 50 messages, oldest first, plus any suggested reply.
CREATE OR REPLACE FUNCTION public.mcp_social_conversation(p_platform text, p_participant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_messages jsonb; v_draft text; v_name text; v_last_in timestamptz;
BEGIN
 v_business := public.mcp_read_business();
 IF p_platform NOT IN ('facebook', 'instagram') OR p_participant_id IS NULL OR length(p_participant_id) > 100 THEN RAISE EXCEPTION 'Choose a conversation from list_social_conversations.'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('from', CASE WHEN direction = 'in' THEN 'customer' ELSE 'business' END, 'text', left(body, 2000), 'sent_at', sent_at, 'status', status) ORDER BY sent_at), '[]'::jsonb)
   INTO v_messages
   FROM (SELECT direction, body, sent_at, status FROM public.social_messages
         WHERE business_id = v_business AND platform = p_platform AND participant_id = p_participant_id
         ORDER BY sent_at DESC LIMIT 50) m;
 IF v_messages = '[]'::jsonb THEN RAISE EXCEPTION 'That conversation was not found in your business.'; END IF;
 SELECT draft_reply INTO v_draft FROM public.social_messages
   WHERE business_id = v_business AND platform = p_platform AND participant_id = p_participant_id AND draft_reply IS NOT NULL
   ORDER BY sent_at DESC LIMIT 1;
 SELECT max(participant_name) FILTER (WHERE participant_name IS NOT NULL), max(sent_at) FILTER (WHERE direction = 'in')
   INTO v_name, v_last_in FROM public.social_messages
   WHERE business_id = v_business AND platform = p_platform AND participant_id = p_participant_id;
 RETURN jsonb_build_object('platform', p_platform, 'customer_name', v_name, 'messages', v_messages, 'suggested_reply', v_draft,
   'last_customer_message_at', v_last_in,
   -- Meta's rules: normal replies within 24 hours, a personal reply up to 7 days, nothing after.
   'reply_window', CASE WHEN v_last_in IS NULL THEN 'closed' WHEN v_last_in > now() - interval '24 hours' THEN 'open' WHEN v_last_in > now() - interval '7 days' THEN 'personal_reply_only' ELSE 'closed' END);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_social_conversation(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_social_conversation(text, text) TO authenticated;

-- Facebook ad spend per campaign and day for the last N days, with the chosen ad account.
CREATE OR REPLACE FUNCTION public.mcp_facebook_ad_spend(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_account record; v_rows jsonb;
BEGIN
 v_business := public.mcp_read_business();
 IF p_days IS NULL OR p_days NOT IN (7, 30, 90) THEN RAISE EXCEPTION 'Choose 7, 30 or 90 days.'; END IF;
 SELECT ad_account_id, ad_account_name, currency, last_spend_sync_at, last_error INTO v_account
   FROM public.meta_ad_accounts WHERE business_id = v_business;
 IF NOT FOUND OR v_account.ad_account_id IS NULL THEN RETURN jsonb_build_object('connected', false, 'rows', '[]'::jsonb); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'campaign_name', campaign_name, 'date', date, 'spend', spend, 'meta_leads', meta_leads)), '[]'::jsonb)
   INTO v_rows FROM (
     SELECT campaign_id, campaign_name, date, spend, meta_leads FROM public.meta_ad_spend_daily
     WHERE business_id = v_business AND ad_account_id = v_account.ad_account_id AND date >= (current_date - (p_days - 1))
     ORDER BY date DESC LIMIT 5000) d;
 RETURN jsonb_build_object('connected', true, 'account_name', v_account.ad_account_name, 'currency', v_account.currency,
   'last_synced_at', v_account.last_spend_sync_at, 'last_error', v_account.last_error, 'rows', v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_facebook_ad_spend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_facebook_ad_spend(integer) TO authenticated;

-- Prepare (not post) a reply to a Facebook/Instagram comment. The owner approves and posts it in BookedSecure.
CREATE OR REPLACE FUNCTION public.mcp_prepare_social_comment_reply(p_comment_id uuid, p_reply text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_status text;
BEGIN
 v_business := public.mcp_write_business();
 IF p_reply IS NULL OR length(btrim(p_reply)) < 1 OR length(p_reply) > 2000 THEN RAISE EXCEPTION 'Write a reply of up to 2000 characters.'; END IF;
 SELECT status INTO v_status FROM public.social_comments WHERE id = p_comment_id AND business_id = v_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That comment was not found in your business.'; END IF;
 IF v_status NOT IN ('pending_review', 'failed') THEN RAISE EXCEPTION 'That comment has already been handled.'; END IF;
 UPDATE public.social_comments SET draft_response = btrim(p_reply), updated_at = now() WHERE id = p_comment_id AND business_id = v_business;
 INSERT INTO public.audit_events(business_id, user_id, event_type, entity_type, entity_id, metadata)
 VALUES (v_business, auth.uid(), 'mcp_social_comment_reply_prepared', 'social_comment', p_comment_id, jsonb_build_object('client_id', auth.jwt()->>'client_id', 'length', length(p_reply)));
 RETURN jsonb_build_object('saved', true, 'posted', false, 'comment_id', p_comment_id);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_prepare_social_comment_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_prepare_social_comment_reply(uuid, text) TO authenticated;

-- Dismiss a comment that needs no reply (nothing is posted or deleted on Facebook).
CREATE OR REPLACE FUNCTION public.mcp_dismiss_social_comment(p_comment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_status text;
BEGIN
 v_business := public.mcp_write_business();
 SELECT status INTO v_status FROM public.social_comments WHERE id = p_comment_id AND business_id = v_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That comment was not found in your business.'; END IF;
 IF v_status NOT IN ('pending_review', 'approved', 'failed') THEN RAISE EXCEPTION 'That comment has already been handled.'; END IF;
 UPDATE public.social_comments SET status = 'dismissed', updated_at = now() WHERE id = p_comment_id AND business_id = v_business;
 INSERT INTO public.audit_events(business_id, user_id, event_type, entity_type, entity_id, metadata)
 VALUES (v_business, auth.uid(), 'mcp_social_comment_dismissed', 'social_comment', p_comment_id, jsonb_build_object('client_id', auth.jwt()->>'client_id', 'previous_status', v_status));
 RETURN jsonb_build_object('saved', true, 'status', 'dismissed', 'comment_id', p_comment_id);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_dismiss_social_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_dismiss_social_comment(uuid) TO authenticated;

-- Prepare (not send) a DM reply. It appears in the reply box in BookedSecure for the owner to send.
CREATE OR REPLACE FUNCTION public.mcp_prepare_social_message_reply(p_platform text, p_participant_id text, p_reply text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_message uuid;
BEGIN
 v_business := public.mcp_write_business();
 IF p_platform NOT IN ('facebook', 'instagram') OR p_participant_id IS NULL OR length(p_participant_id) > 100 THEN RAISE EXCEPTION 'Choose a conversation from list_social_conversations.'; END IF;
 IF p_reply IS NULL OR length(btrim(p_reply)) < 1 OR length(p_reply) > 1000 THEN RAISE EXCEPTION 'Write a reply of up to 1000 characters.'; END IF;
 SELECT id INTO v_message FROM public.social_messages
   WHERE business_id = v_business AND platform = p_platform AND participant_id = p_participant_id AND direction = 'in'
   ORDER BY sent_at DESC LIMIT 1 FOR UPDATE;
 IF v_message IS NULL THEN RAISE EXCEPTION 'That customer has not messaged your business, so there is nothing to reply to.'; END IF;
 UPDATE public.social_messages SET draft_reply = btrim(p_reply) WHERE id = v_message AND business_id = v_business;
 INSERT INTO public.audit_events(business_id, user_id, event_type, entity_type, entity_id, metadata)
 VALUES (v_business, auth.uid(), 'mcp_social_message_reply_prepared', 'social_message', v_message, jsonb_build_object('client_id', auth.jwt()->>'client_id', 'platform', p_platform, 'length', length(p_reply)));
 RETURN jsonb_build_object('saved', true, 'sent', false);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_prepare_social_message_reply(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_prepare_social_message_reply(text, text, text) TO authenticated;

-- Turn the five-minute Facebook lead check on or off, and/or set how far back the first import looks.
CREATE OR REPLACE FUNCTION public.mcp_set_lead_import_schedule(p_auto_sync boolean DEFAULT NULL, p_lookback_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business uuid; v_conn uuid; v_status text;
BEGIN
 v_business := public.mcp_write_business();
 IF p_auto_sync IS NULL AND p_lookback_days IS NULL THEN RAISE EXCEPTION 'Nothing to change.'; END IF;
 IF p_lookback_days IS NOT NULL AND p_lookback_days NOT IN (1, 7, 14, 30, 90) THEN RAISE EXCEPTION 'Choose 1, 7, 14, 30 or 90 days.'; END IF;
 SELECT id, status INTO v_conn, v_status FROM public.lead_sync_connections
   WHERE business_id = v_business AND provider = 'meta_direct' FOR UPDATE;
 IF v_conn IS NULL OR v_status = 'disconnected' THEN RAISE EXCEPTION 'Facebook is not connected. The owner can connect it in BookedSecure under Setup, Connections.'; END IF;
 UPDATE public.lead_sync_connections SET
   auto_sync_enabled = COALESCE(p_auto_sync, auto_sync_enabled),
   next_check_at = CASE WHEN p_auto_sync IS TRUE THEN now() WHEN p_auto_sync IS FALSE THEN NULL ELSE next_check_at END,
   consecutive_failures = CASE WHEN p_auto_sync IS TRUE THEN 0 ELSE consecutive_failures END,
   initial_lookback_days = COALESCE(p_lookback_days, initial_lookback_days)
 WHERE id = v_conn AND business_id = v_business;
 INSERT INTO public.audit_events(business_id, user_id, event_type, entity_type, entity_id, metadata)
 VALUES (v_business, auth.uid(), 'mcp_lead_import_schedule_changed', 'lead_sync_connection', v_conn, jsonb_build_object('client_id', auth.jwt()->>'client_id', 'auto_sync', p_auto_sync, 'lookback_days', p_lookback_days));
 RETURN (SELECT jsonb_build_object('saved', true, 'auto_sync_enabled', auto_sync_enabled, 'initial_lookback_days', initial_lookback_days, 'next_check_at', next_check_at)
         FROM public.lead_sync_connections WHERE id = v_conn);
END; $$;
REVOKE ALL ON FUNCTION public.mcp_set_lead_import_schedule(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_set_lead_import_schedule(boolean, integer) TO authenticated;
