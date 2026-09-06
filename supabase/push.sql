-- Web Push subscriptions for the team chat. Run once in the Supabase SQL editor.
-- One row per browser/device. id = sha256(endpoint), client = staff name from the access code.

create table if not exists public.push_subs (
  id       text primary key,
  client   text   not null,
  endpoint text   not null,
  sub      jsonb  not null,
  ts       bigint not null
);
alter table public.push_subs enable row level security;   -- the service key bypasses RLS, like the other tables
create index if not exists push_subs_client_idx on public.push_subs (client);
