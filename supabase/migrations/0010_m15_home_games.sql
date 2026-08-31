-- 0010_m15_home_games.sql — M15 home game tracker (docs/19).
--
-- Real money played away from the app: groups, a claimable guest roster,
-- cash sessions, a directional ledger, and settlement transfers.
--
-- Two properties are load-bearing:
--
-- 1. STRICT SEPARATION FROM TRAINING DATA. Nothing here references or is
--    referenced by attempts, skill_stats, play_* or XP/streak columns, and
--    it must stay that way — real-money results are not evidence about
--    decision quality (docs/19, docs/04 M15).
-- 2. CLOSED-WRITE RLS. Members get SELECT on what their groups own and
--    nothing else; every write goes through the FastAPI service role
--    (api/games.py), like `friends`. An ex-member (left_at set) reads
--    nothing. All ids are UUIDs/opaque identities — no guessable keys.
--
-- Money is INTEGER CENTS everywhere. Net is always derived from
-- session_entries; it is never stored as the only truth. Corrections VOID
-- an entry rather than deleting it, so the ledger stays auditable.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.poker_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(name) between 1 and 80),
  owner_user_id  uuid not null references public.profiles(id) on delete cascade,
  currency       char(3) not null default 'USD',
  invite_code    text not null unique,
  created_at     timestamptz not null default now()
);

create table public.group_members (
  id        bigint generated always as identity primary key,
  group_id  uuid not null references public.poker_groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  unique (group_id, user_id)
);

-- The roster. Players are stable IDENTITIES — a guest needs no account, and
-- a user who signs up later claims their player row and inherits its whole
-- history because everything hangs off player id, never off a name string.
create table public.group_players (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.poker_groups(id) on delete cascade,
  display_name        text not null check (length(display_name) between 1 and 60),
  claimed_by_user_id  uuid references public.profiles(id) on delete set null,
  archived_at         timestamptz,
  created_at          timestamptz not null default now()
);

-- Guard against accidental duplicates while both SAHIL and SAHIR remain
-- perfectly representable — they are different names and different rows.
create unique index group_players_active_name
  on public.group_players (group_id, lower(display_name))
  where archived_at is null;

create unique index group_players_one_claim_per_user
  on public.group_players (group_id, claimed_by_user_id)
  where claimed_by_user_id is not null;

create table public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.poker_groups(id) on delete cascade,
  session_date     date not null,
  name             text check (name is null or length(name) <= 80),
  stakes           text check (stakes is null or length(stakes) <= 60),
  location         text check (location is null or length(location) <= 80),
  currency         char(3) not null,
  status           text not null default 'live' check (status in ('live', 'settled', 'void')),
  settlement_mode  text check (settlement_mode in ('banker', 'fewest_transfers')),
  banker_player_id uuid references public.group_players(id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  settled_at       timestamptz,
  notes            text,
  created_by       uuid not null references public.profiles(id),
  check (status <> 'settled' or (settled_at is not null and settlement_mode is not null)),
  check (settlement_mode is distinct from 'banker' or banker_player_id is not null)
);

create index game_sessions_by_group on public.game_sessions (group_id, session_date desc);

create table public.session_players (
  id         bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id  uuid not null references public.group_players(id),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique (session_id, player_id)
);

-- The ledger. One directional row per event ($60 in at 9:14pm, +$100 in at
-- 11:02pm, $342 out at 1am). A single direction column handles rebuys,
-- leaving early, and buying back in after cashing out with no special cases.
create table public.session_entries (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.game_sessions(id) on delete cascade,
  player_id   uuid not null references public.group_players(id),
  direction   text not null check (direction in ('in', 'out')),
  kind        text not null check (kind in ('buyin', 'rebuy', 'addon', 'cashout')),
  amount_cents integer not null check (amount_cents > 0),
  occurred_at timestamptz not null default now(),
  -- Imported sheet rows are night TOTALS, not observed events; the flag
  -- keeps them from ever being mistaken for real rebuy timing.
  imported    boolean not null default false,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references public.profiles(id),
  check ((kind = 'cashout') = (direction = 'out')),
  check ((voided_at is null) = (voided_by is null))
);

create index session_entries_by_session on public.session_entries (session_id, occurred_at);

-- Who pays whom, produced server-side at settle time from the ledger, in
-- the session's chosen mode. paid_at is the mark-as-paid checkbox; no money
-- moves through the app.
create table public.session_settlements (
  id             bigint generated always as identity primary key,
  session_id     uuid not null references public.game_sessions(id) on delete cascade,
  from_player_id uuid not null references public.group_players(id),
  to_player_id   uuid not null references public.group_players(id),
  amount_cents   integer not null check (amount_cents > 0),
  mode           text not null check (mode in ('banker', 'fewest_transfers')),
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  check (from_player_id <> to_player_id)
);

create index session_settlements_by_session on public.session_settlements (session_id);

-- ---------------------------------------------------------------------
-- RLS — member-only SELECT, no write policies at all
-- ---------------------------------------------------------------------

-- security definer so the group_members policy can consult group_members
-- without recursing into its own policy.
create or replace function public.is_active_group_member(gid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and left_at is null
  );
$$;

alter table public.poker_groups       enable row level security;
alter table public.group_members      enable row level security;
alter table public.group_players      enable row level security;
alter table public.game_sessions      enable row level security;
alter table public.session_players    enable row level security;
alter table public.session_entries    enable row level security;
alter table public.session_settlements enable row level security;

create policy "members read group" on public.poker_groups
  for select to authenticated
  using (public.is_active_group_member(id) or owner_user_id = auth.uid());

create policy "members read membership" on public.group_members
  for select to authenticated
  using (public.is_active_group_member(group_id));

create policy "members read roster" on public.group_players
  for select to authenticated
  using (public.is_active_group_member(group_id));

create policy "members read sessions" on public.game_sessions
  for select to authenticated
  using (public.is_active_group_member(group_id));

create policy "members read session players" on public.session_players
  for select to authenticated
  using (public.is_active_group_member(
    (select group_id from public.game_sessions gs where gs.id = session_id)
  ));

create policy "members read entries" on public.session_entries
  for select to authenticated
  using (public.is_active_group_member(
    (select group_id from public.game_sessions gs where gs.id = session_id)
  ));

create policy "members read settlements" on public.session_settlements
  for select to authenticated
  using (public.is_active_group_member(
    (select group_id from public.game_sessions gs where gs.id = session_id)
  ));
