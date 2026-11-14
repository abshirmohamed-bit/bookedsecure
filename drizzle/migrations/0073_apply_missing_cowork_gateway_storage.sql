-- Co-Work gateways: server-only storage. HTTP schedules are managed separately.
create table if not exists public.cowork_gateways (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null,
  channel text not null check (channel in ('sms', 'email', 'telegram')),
  address text,
  token text,
  verify_code_hash text,
  verify_sent_at timestamptz,
  verify_attempts integer not null default 0,
  verified_at timestamptz,
  enabled boolean not null default true,
  thread_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.cowork_gateways from anon, authenticated;
grant all on public.cowork_gateways to service_role;
alter table public.cowork_gateways enable row level security;
create unique index if not exists cowork_gateways_one_per_person
  on public.cowork_gateways (business_id, user_id, channel);
create unique index if not exists cowork_gateways_token
  on public.cowork_gateways (token) where token is not null;
create unique index if not exists cowork_gateways_telegram_chat
  on public.cowork_gateways (address) where channel = 'telegram' and verified_at is not null;
create index if not exists cowork_gateways_lookup
  on public.cowork_gateways (channel, address) where verified_at is not null;
create table if not exists public.cowork_gateway_messages (
  id uuid primary key default gen_random_uuid(),
  gateway_id uuid not null references public.cowork_gateways(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email', 'telegram')),
  external_id text not null,
  body text not null,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  reply text,
  error text,
  created_at timestamptz not null default now()
);
revoke all on public.cowork_gateway_messages from anon, authenticated;
grant all on public.cowork_gateway_messages to service_role;
alter table public.cowork_gateway_messages enable row level security;
create unique index if not exists cowork_gateway_messages_once
  on public.cowork_gateway_messages (channel, external_id);
create index if not exists cowork_gateway_messages_queue
  on public.cowork_gateway_messages (status, created_at) where status in ('queued', 'running');
create index if not exists cowork_gateway_messages_daily
  on public.cowork_gateway_messages (gateway_id, created_at);