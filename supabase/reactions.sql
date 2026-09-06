-- Emoji reactions on team chat messages. Run once in the Supabase SQL editor.
-- One row per person per emoji per message. id = sha1(msg|client|emoji). mts = the message's ts,
-- so a day's reactions load with one range query alongside the day's messages.

create table if not exists public.reactions (
  id     text primary key,
  msg    text   not null,
  mts    bigint not null,
  client text   not null,
  emoji  text   not null,
  ts     bigint not null
);
alter table public.reactions enable row level security;
create index if not exists reactions_mts_idx on public.reactions (mts);
create index if not exists reactions_msg_idx on public.reactions (msg);
