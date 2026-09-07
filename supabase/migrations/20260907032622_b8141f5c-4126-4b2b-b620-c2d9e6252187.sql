alter table public.leads add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists leads_public_token_idx on public.leads (public_token);