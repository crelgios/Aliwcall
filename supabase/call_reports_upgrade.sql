-- AliwCall call-report storage upgrade
-- Run this once in Supabase SQL Editor before testing the updated webhook.

alter table public.calls
  add column if not exists provider_call_id text,
  add column if not exists transcript text,
  add column if not exists raw_report jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz;

-- Existing columns used by the dashboard/webhook.
alter table public.calls
  add column if not exists direction text,
  add column if not exists caller_number text,
  add column if not exists callee_number text,
  add column if not exists duration_seconds integer default 0,
  add column if not exists summary text,
  add column if not exists status text;

create unique index if not exists calls_provider_call_id_unique
  on public.calls(provider_call_id)
  where provider_call_id is not null;

grant select, insert, update on public.calls to service_role;
grant select on public.calls to authenticated;
