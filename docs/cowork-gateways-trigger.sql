-- Co-Work gateways: answer a message the moment it is queued.
--
-- Replaces the every-minute job in docs/cowork-gateways.sql (never applied):
-- no timer and no public key. Each new queued row in cowork_gateway_messages
-- makes one HTTP call, through pg_net after the insert commits, to the app's
-- /api/public/hooks/cowork-gateway, carrying a dedicated secret. The hook
-- refuses anything without it, then answers what is waiting. The 10-minute
-- follow-ups hook stays as the fallback if a call is ever lost.
--
-- Lovable, before applying:
--   1. Make a long random secret (32+ characters, letters and numbers).
--   2. Add it as the app secret COWORK_GATEWAY_SECRET.
--   3. Store the same value in the database's Vault under the name
--      cowork_gateway_secret:
--        select vault.create_secret('<the secret>', 'cowork_gateway_secret',
--          'Co-Work gateway hook (x-cowork-gateway-secret)');
-- Without the Vault secret the trigger does nothing, and messages are still
-- answered by the 10-minute fallback.

create extension if not exists pg_net;

create or replace function private.kick_cowork_gateway()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'cowork_gateway_secret'
  limit 1;
  if secret is null or length(secret) < 24 then
    return null;
  end if;
  perform net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/cowork-gateway',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cowork-gateway-secret', secret),
    body := jsonb_build_object('message_id', new.id),
    -- An answer can take a minute (Co-Work reads records, then texts back).
    timeout_milliseconds := 120000
  );
  return null;
exception when others then
  -- Never block a message being queued: the fallback will answer it.
  return null;
end;
$$;

revoke all on function private.kick_cowork_gateway() from public, anon, authenticated;

drop trigger if exists cowork_gateway_kick on public.cowork_gateway_messages;
create trigger cowork_gateway_kick
  after insert on public.cowork_gateway_messages
  for each row
  when (new.status = 'queued')
  execute function private.kick_cowork_gateway();
