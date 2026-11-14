-- AI Caller (Co-Work): calls with leads, their transcript and what was captured.
--
-- Today calls are logged by the owner (notes or a transcript pasted after a
-- call they made); Co-Work reads them and fills the lead's fields for the
-- owner to check and save. When voice calling (Telnyx) is connected, its
-- calls land in the same table. Server-written; the team can read their own
-- business's calls.
-- Lovable: apply this, then publish. Until then the AI Caller card says it is
-- waiting for this update and nothing else changes.

create table if not exists public.lead_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid,
  -- logged: entered by the owner after a call; telnyx: placed or received by the AI caller.
  provider text not null default 'logged' check (provider in ('logged', 'telnyx')),
  provider_call_id text,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  status text not null default 'completed'
    check (status in ('queued', 'ringing', 'live', 'completed', 'no_answer', 'failed')),
  phone_number text,
  campaign text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer,
  -- [{ "role": "agent" | "prospect" | "note", "text": "...", "at_ms": 1234 }]
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  -- The lead fields read from the call (leads columns only) plus preferred_time.
  captured jsonb not null default '{}'::jsonb,
  recording_path text,
  saved_at timestamptz,
  saved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_calls_recent on public.lead_calls (business_id, created_at desc);
create index if not exists lead_calls_lead on public.lead_calls (lead_id) where lead_id is not null;
create unique index if not exists lead_calls_provider_call on public.lead_calls (provider, provider_call_id)
  where provider_call_id is not null;

alter table public.lead_calls enable row level security;
revoke all on public.lead_calls from anon, authenticated;
grant select on public.lead_calls to authenticated;
grant all on public.lead_calls to service_role;

drop policy if exists "lead calls readable in tenant" on public.lead_calls;
create policy "lead calls readable in tenant" on public.lead_calls
  for select to authenticated using (business_id = private.current_business_id());
