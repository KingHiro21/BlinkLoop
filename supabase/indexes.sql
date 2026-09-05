-- Indexes for the team chat tables. Run once in the Supabase SQL editor.
-- Every /api/chat poll filters messages by parent + ts and presence by ts;
-- without these Postgres scans the whole table on each request.

create index if not exists messages_parent_ts_idx on public.messages (parent, ts);
create index if not exists messages_ts_idx        on public.messages (ts desc);
create index if not exists presence_ts_idx        on public.presence (ts);
create index if not exists pins_ts_idx            on public.pins (ts desc);
