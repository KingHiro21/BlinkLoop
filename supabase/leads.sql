-- Leads from the contact forms (the BlinkLoop site and every site published from the builder).
-- Run once in the Supabase SQL editor. RLS on; the service key used by /api/lead and /api/leads bypasses it.
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  site        text not null default 'blinkloop',          -- 'blinkloop' or the published site's slug
  name        text not null,
  email       text not null,
  phone       text,
  business    text,
  service     text,
  message     text not null,
  page        text,
  consent_at  timestamptz,
  status      text not null default 'new',                -- new | contacted | quoted | won | lost
  note        text,
  ip_hash     text,
  ua          text
);
create index if not exists leads_ts_idx on leads (ts desc);
create index if not exists leads_site_idx on leads (site, ts desc);
alter table leads enable row level security;
