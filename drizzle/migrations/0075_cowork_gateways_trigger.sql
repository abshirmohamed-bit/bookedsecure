alter table public.cowork_gateway_messages add column if not exists kick_token text;

create extension if not exists pg_net;

create or replace function private.kick_cowork_gateway()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kick_token is null or length(new.kick_token) < 24 then
    return null;
  end if;
  perform net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/cowork-gateway',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('message_id', new.id, 'token', new.kick_token),
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