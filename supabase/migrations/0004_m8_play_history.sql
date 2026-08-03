-- 0004_m8_play_history.sql — M8 durable play history and GTO telemetry.
--
-- `attempts` remains the XP/streak event log.  These tables are the
-- authoritative, queryable coaching record.  Browser roles may read their
-- own rows, but only the trusted API/database role may write grading data.

-- ---------------------------------------------------------------------
-- Immutable solve-pack catalog
-- ---------------------------------------------------------------------

create table public.play_solve_packs (
  id                    text primary key,
  solution_profile_id   text not null,
  solution_version      text not null,
  spot                  text not null,
  format_version        integer not null check (format_version > 0),
  grading_version       text not null,
  content_hash          text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  metadata              jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(metadata) = 'object'),
  published_at          timestamptz not null,
  created_at            timestamptz not null default now(),
  unique (solution_profile_id, solution_version, spot)
);

comment on table public.play_solve_packs is
  'Immutable registry for versioned solve artifacts and explicitly unverified legacy archives.';
comment on column public.play_solve_packs.content_hash is
  'SHA-256 over the canonical inputs identified by metadata; solve packs cover their manifest, files, and grading metadata.';

insert into public.play_solve_packs
  (id, solution_profile_id, solution_version, spot, format_version,
   grading_version, content_hash, metadata, published_at)
values
  (
    'potluck:m6:srp-btn-bb:v1',
    'cash-6max-chip-ev',
    'm6-v1',
    'srp-btn-bb',
    1,
    'play-grade:v1',
    'sha256:ea2ec51324b7eac09c28c992b4cbd97248bda8d42d85624f372909c1cdbb6ca8',
    jsonb_build_object(
      'manifest', '/solves/srp-btn-bb/index.json',
      'catalog', '/solves/srp-btn-bb/catalog.json',
      'starting_pot_bb', 5.5,
      'stack_behind_bb', 97.5,
      'effective_stack_bb', 100,
      'rake_model', 'none',
      'ev_model', 'chip_ev',
      'absolute_action_ev_available', false
    ),
    '2026-07-31T00:00:00Z'::timestamptz
  ),
  (
    -- Existing M6 attempt payloads were authored and graded in the browser.
    -- Keep them in a versioned archive namespace instead of claiming that
    -- their client-supplied cards/path were verified against the solve pack.
    'potluck:legacy-play-attempts:v1',
    'legacy-client-play',
    'm6-attempt-payload-v1',
    'srp-btn-bb',
    1,
    'legacy-unverified:v1',
    'sha256:850271ecfb2db96848a056a17fbc33d063f8299a123d83f92fe1c5050ea744f9',
    jsonb_build_object(
      'kind', 'legacy_attempt_archive',
      'authoritative', false,
      'claimed_solve_pack_id', 'potluck:m6:srp-btn-bb:v1',
      'content_hash_input',
        'potluck:legacy-play-attempts:v1|legacy-client-play|m6-attempt-payload-v1|unverified'
    ),
    '2026-08-03T00:00:00Z'::timestamptz
  );

create or replace function public.prevent_play_solve_pack_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'play solve-pack catalog is immutable'
      using errcode = '23514';
  end if;
  raise exception 'play solve pack % is immutable', old.id
    using errcode = '23514';
end;
$$;

create trigger play_solve_packs_immutable
  before update or delete on public.play_solve_packs
  for each row execute function public.prevent_play_solve_pack_mutation();

create trigger play_solve_packs_no_truncate
  before truncate on public.play_solve_packs
  for each statement execute function public.prevent_play_solve_pack_mutation();

-- ---------------------------------------------------------------------
-- Session: frozen practice configuration and lifecycle
-- ---------------------------------------------------------------------

create table public.play_sessions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  client_session_id        uuid not null,
  solve_pack_id            text not null references public.play_solve_packs(id),
  status                   text not null default 'incomplete'
                           check (status in ('incomplete', 'completed', 'abandoned')),
  config_snapshot          jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  solution_profile_id      text not null,
  solution_version         text not null,
  table_size               smallint not null check (table_size between 2 and 10),
  hero_positions           text[] not null check (cardinality(hero_positions) > 0),
  matchup_positions        text[] not null check (cardinality(matchup_positions) > 0),
  starting_spot            text not null,
  action_family_filters    text[] not null default '{}'::text[],
  stack_depth_bb           numeric(8, 3) not null check (stack_depth_bb > 0),
  rake_model               text not null,
  ev_model                 text not null,
  advanced_settings        jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(advanced_settings) = 'object'),
  started_at               timestamptz not null default now(),
  last_activity_at         timestamptz not null default now(),
  completed_at             timestamptz,
  abandoned_at             timestamptz,
  unique (user_id, client_session_id),
  unique (id, user_id),
  check (last_activity_at >= started_at),
  check (
    (status = 'incomplete' and completed_at is null and abandoned_at is null)
    or (status = 'completed' and completed_at is not null and abandoned_at is null)
    or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
  )
);

comment on table public.play_sessions is
  'One durable practice run. config_snapshot is frozen even if product defaults later change.';
comment on column public.play_sessions.client_session_id is
  'Caller-generated UUID; unique per user so retrying session creation is idempotent.';

create index play_sessions_user_recent_idx
  on public.play_sessions (user_id, started_at desc, id desc);
create index play_sessions_user_incomplete_idx
  on public.play_sessions (user_id, last_activity_at desc)
  where status = 'incomplete';

-- ---------------------------------------------------------------------
-- Hand: stable deal identity, complete replay snapshot and lifecycle
-- ---------------------------------------------------------------------

create table public.play_hands (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  session_id               uuid not null,
  client_hand_id           uuid not null,
  source_hand_id           text not null,
  solve_pack_id            text not null references public.play_solve_packs(id),
  status                   text not null default 'incomplete'
                           check (status in ('incomplete', 'completed', 'abandoned')),
  hand_index               integer not null check (hand_index >= 0),
  hero_position            text not null,
  opponent_positions       text[] not null check (cardinality(opponent_positions) > 0),
  spot                     text not null,
  stack_depth_bb           numeric(8, 3) not null check (stack_depth_bb > 0),
  starting_street          text not null
                           check (starting_street in ('preflop', 'flop', 'turn', 'river')),
  starting_node_id         text not null,
  hero_cards               text[] not null default '{}'::text[]
                           check (cardinality(hero_cards) <= 2),
  opponent_cards           jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(opponent_cards) = 'object'),
  initial_board_cards      text[] not null default '{}'::text[]
                           check (cardinality(initial_board_cards) <= 5),
  runout_cards             text[] not null default '{}'::text[]
                           check (cardinality(runout_cards) <= 5),
  action_history_snapshot  jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(action_history_snapshot) = 'array'),
  deal_snapshot            jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(deal_snapshot) = 'object'),
  result_snapshot          jsonb
                           check (result_snapshot is null or jsonb_typeof(result_snapshot) = 'object'),
  started_at               timestamptz not null default now(),
  last_activity_at         timestamptz not null default now(),
  completed_at             timestamptz,
  abandoned_at             timestamptz,
  foreign key (session_id, user_id)
    references public.play_sessions(id, user_id) on delete cascade,
  unique (session_id, client_hand_id),
  unique (session_id, hand_index),
  unique (id, user_id),
  check (last_activity_at >= started_at),
  check (
    (status = 'incomplete' and completed_at is null and abandoned_at is null)
    or (status = 'completed' and completed_at is not null and abandoned_at is null)
    or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
  )
);

comment on table public.play_hands is
  'One dealt/replayed hand. source_hand_id names the immutable pack instance; client_hand_id makes creation retry-safe.';
comment on column public.play_hands.deal_snapshot is
  'Frozen reproducibility inputs not promoted to columns, including source indices, seats, pot, and scripted branch data.';

create index play_hands_user_recent_idx
  on public.play_hands (user_id, started_at desc, id desc);
create index play_hands_session_status_idx
  on public.play_hands (session_id, status, hand_index);
create index play_hands_source_idx
  on public.play_hands (user_id, source_hand_id, started_at desc);
create index play_hands_user_incomplete_idx
  on public.play_hands (user_id, last_activity_at desc)
  where status = 'incomplete';

-- ---------------------------------------------------------------------
-- Decision: normalized analytics dimensions and authoritative grade
-- ---------------------------------------------------------------------

create table public.play_decisions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  hand_id                  uuid not null,
  client_decision_id       uuid not null,
  attempt_id               bigint unique references public.attempts(id) on delete set null,
  solve_pack_id            text not null references public.play_solve_packs(id),
  solve_node_id            text not null,
  decision_index           integer not null check (decision_index >= 0),
  position                 text not null,
  spot                     text not null,
  stack_depth_bb           numeric(8, 3) not null check (stack_depth_bb > 0),
  street                   text not null
                           check (street in ('preflop', 'flop', 'turn', 'river')),
  board_cards              text[] not null default '{}'::text[]
                           check (cardinality(board_cards) <= 5),
  board_texture            text,
  hand_class               text,
  action_context           jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(action_context) = 'object'),
  chosen_action_code       text not null,
  grading_source           text not null
                           check (grading_source in ('solver', 'reference', 'ungraded')),
  grading_status           text not null
                           check (grading_status in
                             ('validated', 'reference_graded', 'legacy_unverified', 'ungraded')),
  grading_version          text,
  ev_basis                 text not null default 'unknown'
                           check (ev_basis in ('absolute', 'relative_to_best', 'unknown')),
  chosen_frequency         numeric(9, 8)
                           check (chosen_frequency between 0 and 1),
  chosen_ev_bb             numeric(12, 6),
  best_ev_bb               numeric(12, 6),
  ev_loss_bb               numeric(12, 6) check (ev_loss_bb >= 0),
  verdict                  text not null
                           check (verdict in
                             ('correct', 'acceptable', 'inaccuracy', 'blunder', 'ungraded')),
  is_correct               boolean generated always as (
                             case
                               when verdict in ('correct', 'acceptable') then true
                               when verdict in ('inaccuracy', 'blunder') then false
                               else null
                             end
                           ) stored,
  alternatives_complete    boolean not null default false,
  occurred_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  foreign key (hand_id, user_id)
    references public.play_hands(id, user_id) on delete cascade,
  unique (hand_id, client_decision_id),
  unique (hand_id, decision_index),
  unique (hand_id, solve_node_id),
  unique (id, user_id),
  check (
    (grading_status = 'validated' and grading_source = 'solver')
    or (grading_status = 'reference_graded' and grading_source = 'reference')
    or (grading_status = 'legacy_unverified' and grading_source in ('solver', 'reference'))
    or (grading_status = 'ungraded' and grading_source = 'ungraded')
  ),
  check (grading_status = 'ungraded' or grading_version is not null),
  check (
    ev_basis <> 'unknown'
    or (chosen_ev_bb is null and best_ev_bb is null and ev_loss_bb is null)
  ),
  check (
    grading_source <> 'reference'
    or (chosen_ev_bb is null and best_ev_bb is null and ev_loss_bb is null)
  )
);

comment on table public.play_decisions is
  'One hero choice. The trusted API derives grading fields and alternatives from solve_pack_id + solve_node_id.';
comment on column public.play_decisions.ev_basis is
  'absolute: action EVs exist; relative_to_best: only EV deltas/losses exist; unknown: no EV claim is possible.';
comment on column public.play_decisions.alternatives_complete is
  'True only when play_decision_actions contains every legal action at the referenced node.';

create index play_decisions_hand_order_idx
  on public.play_decisions (hand_id, decision_index);
create index play_decisions_user_recent_idx
  on public.play_decisions (user_id, occurred_at desc, id desc);
create index play_decisions_weakness_idx
  on public.play_decisions
    (user_id, street, position, spot, occurred_at desc)
  where grading_status in ('validated', 'reference_graded');
create index play_decisions_texture_idx
  on public.play_decisions
    (user_id, board_texture, hand_class, occurred_at desc)
  where grading_status in ('validated', 'reference_graded');

-- One row per legal action.  Keeping alternatives relational makes both a
-- complete review and aggregate action-family analysis straightforward.
create table public.play_decision_actions (
  decision_id             uuid not null,
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  action_code             text not null,
  ordinal                 integer not null check (ordinal >= 0),
  action_label            text not null,
  action_kind             text not null
                          check (action_kind in ('check', 'fold', 'call', 'bet', 'raise', 'all_in')),
  amount_bb               numeric(12, 6) check (amount_bb is null or amount_bb >= 0),
  frequency               numeric(9, 8) check (frequency between 0 and 1),
  ev_bb                   numeric(12, 6),
  ev_delta_bb             numeric(12, 6) check (ev_delta_bb <= 0),
  ev_loss_bb              numeric(12, 6) check (ev_loss_bb >= 0),
  is_chosen               boolean not null default false,
  created_at              timestamptz not null default now(),
  primary key (decision_id, action_code),
  foreign key (decision_id, user_id)
    references public.play_decisions(id, user_id) on delete cascade,
  unique (decision_id, ordinal),
  check (
    (ev_delta_bb is null and ev_loss_bb is null)
    or (ev_delta_bb is not null and ev_loss_bb is not null and ev_delta_bb = -ev_loss_bb)
  )
);

comment on column public.play_decision_actions.ev_bb is
  'Absolute action EV in big blinds; null for M6 because that pack exports only loss versus best.';
comment on column public.play_decision_actions.ev_delta_bb is
  'Non-positive EV difference versus the best action; the additive inverse of ev_loss_bb.';

create unique index play_decision_actions_one_chosen_idx
  on public.play_decision_actions (decision_id)
  where is_chosen;
create index play_decision_actions_user_idx
  on public.play_decision_actions (user_id, decision_id, ordinal);

-- A completed or abandoned record is terminal.  Incomplete records survive
-- reloads until the API explicitly completes or abandons them.
create or replace function public.enforce_play_terminal_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('completed', 'abandoned') and new.status <> old.status then
    raise exception 'play % status % is terminal', tg_table_name, old.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger play_sessions_terminal_status
  before update of status on public.play_sessions
  for each row execute function public.enforce_play_terminal_status();

create trigger play_hands_terminal_status
  before update of status on public.play_hands
  for each row execute function public.enforce_play_terminal_status();

-- ---------------------------------------------------------------------
-- Conservative backfill from M6 generic attempts
-- ---------------------------------------------------------------------
--
-- Old rows contain one client-supplied chosen action, not a complete hand
-- snapshot or all node alternatives.  We import only well-formed M6 payloads,
-- keep their raw payload in action_context, and mark their grades unverified.
-- In particular, preflop is identified as reference-sourced data, but every EV
-- field remains null rather than treating the old UI's display-only zero as EV.

create temporary table m8_legacy_play_rows as
with candidates as (
  select
    a.id as attempt_id,
    a.user_id,
    a.drill_payload,
    a.selected_choice_id,
    a.is_correct as legacy_is_correct,
    a.created_at,
    a.drill_payload->>'phase' as phase,
    a.drill_payload->>'flop' as flop,
    -- CASE, rather than a separate regex predicate, is deliberate: Postgres
    -- may reorder WHERE expressions. A client-controlled non-integer or an
    -- enormous digit string must never reach a cast and abort the migration.
    case
      when a.drill_payload->>'instance' ~ '^[0-9]{1,3}$'
      then (a.drill_payload->>'instance')::integer
      else null
    end as instance_index,
    a.drill_payload->>'hero' as hero_side,
    a.drill_payload->>'hand' as hero_hand,
    case
      when a.drill_payload->>'freq' ~ '^[0-9]{1,3}$'
      then (a.drill_payload->>'freq')::integer
      else null
    end as legacy_frequency_quantized,
    case
      when a.drill_payload->>'loss' ~ '^[0-9]{1,3}$'
      then (a.drill_payload->>'loss')::integer
      else null
    end as legacy_loss_quantized,
    case
      when substr(
        coalesce(nullif(a.drill_payload->>'chosen', ''), a.selected_choice_id),
        2
      ) ~ '^[0-9]{1,6}$'
      then substr(
        coalesce(nullif(a.drill_payload->>'chosen', ''), a.selected_choice_id),
        2
      )::numeric / 10
      else null
    end as legacy_amount_bb
  from public.attempts a
  where a.drill_kind = 'play'
    and jsonb_typeof(a.drill_payload) = 'object'
    and a.drill_payload->>'spot' = 'srp-btn-bb'
    and a.drill_payload->>'phase' in ('preflop', 'postflop')
), eligible as (
  select
    c.*,
    'potluck:legacy-play-attempts:v1/' || c.flop || '#'
      || c.instance_index::text as source_hand_id
  from candidates c
  where c.flop ~ '^([2-9TJQKA][shdc]){3}$'
    -- A legacy payload was client-controlled. Restrict archive rows to the
    -- shape of the historical M6 bank (25 flops, 200 instances per flop), but
    -- retain the separate unverified namespace even when this shape matches.
    and c.flop = any (array[
      '6s5d4h', '7d6h2c', '8h8c3s', '8s7h5d', '9d6c2s',
      '9h8s7d', 'AdTs9s', 'AhKd5c', 'As5h4h', 'As7d2c',
      'AsKhQd', 'AsQd6h', 'Jh7s3d', 'JsTd8h', 'Kd7h2s',
      'KhTs6d', 'KsJs5d', 'KsQd8h', 'QdTh7s', 'Qh6d2c',
      'Qs8s3s', 'QsJh8d', 'QsQh4d', 'Th8d6c', 'Ts9s5h'
    ]::text[])
    and c.instance_index between 0 and 199
    and c.hero_side in ('0', '1')
    and c.hero_hand ~ '^([2-9TJQKA][shdc]){2}$'
), with_previous as (
  select
    e.*,
    lag(e.source_hand_id) over
      (partition by e.user_id order by e.created_at, e.attempt_id) as previous_source_hand_id,
    row_number() over
      (partition by e.user_id order by e.created_at, e.attempt_id) as user_row_number
  from eligible e
), marked as (
  select
    p.*,
    case
      when p.user_row_number = 1 then 1
      when p.phase = 'preflop' then 1
      when p.source_hand_id is distinct from p.previous_source_hand_id then 1
      else 0
    end as starts_hand
  from with_previous p
), segmented as (
  select
    m.*,
    sum(m.starts_hand) over
      (partition by m.user_id order by m.created_at, m.attempt_id) as hand_segment
  from marked m
), ranked_nodes as (
  select
    s.*,
    min(s.attempt_id) over
      (partition by s.user_id, s.hand_segment) as first_attempt_id,
    row_number() over (
      partition by s.user_id, s.hand_segment,
        case
          when s.phase = 'preflop' then 'preflop'
          else coalesce(nullif(s.drill_payload->>'path', ''), 'root')
        end
      order by s.created_at, s.attempt_id
    ) as node_occurrence
  from segmented s
), unique_nodes as (
  -- Generic attempts had no idempotency identity. If a retry wrote the same
  -- inferred node twice, retain the first archive row rather than aborting the
  -- migration on the normalized hand/node uniqueness constraint.
  select r.*
  from ranked_nodes r
  where r.node_occurrence = 1
)
select
  u.*,
  row_number() over
    (partition by u.user_id, u.hand_segment order by u.created_at, u.attempt_id) - 1
      as decision_index
from unique_nodes u;

insert into public.play_sessions (
  id, user_id, client_session_id, solve_pack_id, status, config_snapshot,
  solution_profile_id, solution_version, table_size, hero_positions,
  matchup_positions, starting_spot, action_family_filters, stack_depth_bb,
  rake_model, ev_model, advanced_settings, started_at, last_activity_at,
  abandoned_at
)
select
  md5('m8:legacy-session:' || r.user_id::text)::uuid,
  r.user_id,
  md5('m8:legacy-client-session:' || r.user_id::text)::uuid,
  'potluck:legacy-play-attempts:v1',
  'abandoned',
  jsonb_build_object(
    'solution_profile_id', 'legacy-client-play',
    'solution_version', 'm6-attempt-payload-v1',
    'table_size', 6,
    'hero_positions', jsonb_build_array('BTN', 'BB'),
    'matchup_positions', jsonb_build_array('BTN', 'BB'),
    'starting_spot', 'preflop',
    'action_family_filters', jsonb_build_array('single_raised_pot'),
    'stack_depth_bb', 100,
    'rake_model', 'none',
    'ev_model', 'chip_ev',
    'advanced_settings', jsonb_build_object('legacy_import', true)
  ),
  'legacy-client-play',
  'm6-attempt-payload-v1',
  6,
  array['BTN', 'BB']::text[],
  array['BTN', 'BB']::text[],
  'preflop',
  array['single_raised_pot']::text[],
  100,
  'none',
  'chip_ev',
  jsonb_build_object('legacy_import', true),
  min(r.created_at),
  max(r.created_at),
  max(r.created_at)
from m8_legacy_play_rows r
group by r.user_id
on conflict (user_id, client_session_id) do nothing;

insert into public.play_hands (
  id, user_id, session_id, client_hand_id, source_hand_id, solve_pack_id,
  status, hand_index, hero_position, opponent_positions, spot, stack_depth_bb,
  starting_street, starting_node_id, hero_cards, initial_board_cards,
  deal_snapshot, started_at, last_activity_at
)
select
  md5('m8:legacy-hand:' || r.user_id::text || ':' || r.first_attempt_id::text)::uuid,
  r.user_id,
  md5('m8:legacy-session:' || r.user_id::text)::uuid,
  md5('m8:legacy-client-hand:' || r.user_id::text || ':' || r.first_attempt_id::text)::uuid,
  min(r.source_hand_id),
  'potluck:legacy-play-attempts:v1',
  'incomplete',
  (r.hand_segment - 1)::integer,
  case min(r.hero_side) when '1' then 'BTN' else 'BB' end,
  case min(r.hero_side)
    when '1' then array['BB']::text[]
    else array['BTN']::text[]
  end,
  'srp-btn-bb',
  100,
  case when bool_or(r.phase = 'preflop') then 'preflop'
       else case min(r.drill_payload->>'street')
         when '1' then 'turn' when '2' then 'river' else 'flop' end
  end,
  min(r.source_hand_id) || '/'
    || case when bool_or(r.phase = 'preflop') then 'preflop'
            else coalesce(nullif(min(r.drill_payload->>'path'), ''), 'root') end,
  array[substr(min(r.hero_hand), 1, 2), substr(min(r.hero_hand), 3, 2)]::text[],
  array[substr(min(r.flop), 1, 2), substr(min(r.flop), 3, 2),
        substr(min(r.flop), 5, 2)]::text[],
  jsonb_build_object(
    'legacy_import', true,
    'flop', min(r.flop),
    'instance_index', min(r.instance_index),
    'hero_side', min(r.hero_side)::integer,
    'claimed_solve_pack_id', 'potluck:m6:srp-btn-bb:v1',
    'source_association_verified', false,
    'snapshot_complete', false
  ),
  min(r.created_at),
  max(r.created_at)
from m8_legacy_play_rows r
group by r.user_id, r.hand_segment, r.first_attempt_id
on conflict (session_id, client_hand_id) do nothing;

insert into public.play_decisions (
  id, user_id, hand_id, client_decision_id, attempt_id, solve_pack_id,
  solve_node_id, decision_index, position, spot, stack_depth_bb, street,
  board_cards, hand_class, action_context, chosen_action_code, grading_source,
  grading_status, grading_version, ev_basis, chosen_frequency, ev_loss_bb,
  verdict, alternatives_complete, occurred_at, created_at
)
select
  md5('m8:legacy-decision:' || r.attempt_id::text)::uuid,
  r.user_id,
  md5('m8:legacy-hand:' || r.user_id::text || ':' || r.first_attempt_id::text)::uuid,
  md5('m8:legacy-client-decision:' || r.attempt_id::text)::uuid,
  r.attempt_id,
  'potluck:legacy-play-attempts:v1',
  r.source_hand_id || '/' || case
    when r.phase = 'preflop' then 'preflop'
    else coalesce(nullif(r.drill_payload->>'path', ''), 'root')
  end,
  r.decision_index::integer,
  case r.hero_side when '1' then 'BTN' else 'BB' end,
  'srp-btn-bb',
  100,
  case when r.phase = 'preflop' then 'preflop'
       else case r.drill_payload->>'street'
         when '1' then 'turn' when '2' then 'river' else 'flop' end
  end,
  case when r.phase = 'preflop' then '{}'::text[]
       else array[substr(r.flop, 1, 2), substr(r.flop, 3, 2), substr(r.flop, 5, 2)]::text[]
  end,
  case when r.phase = 'preflop' then r.drill_payload->>'notation' else null end,
  jsonb_build_object(
    'legacy_attempt_payload', r.drill_payload,
    'legacy_attempt_is_correct', r.legacy_is_correct,
    'claimed_solve_pack_id', 'potluck:m6:srp-btn-bb:v1',
    'source_association_verified', false,
    'board_snapshot_complete', r.phase = 'preflop'
  ),
  coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id),
  case when r.phase = 'preflop' then 'reference' else 'solver' end,
  'legacy_unverified',
  case when r.phase = 'preflop' then 'reference-ranges:v1' else 'play-grade:v1' end,
  case when r.phase = 'preflop' then 'unknown' else 'relative_to_best' end,
  case
    when r.phase = 'postflop'
      and r.legacy_frequency_quantized between 0 and 255
    then r.legacy_frequency_quantized::numeric / 255
    else null
  end,
  case
    when r.phase = 'postflop'
      and r.legacy_loss_quantized between 0 and 255
    then r.legacy_loss_quantized::numeric * 0.05
    else null
  end,
  'ungraded',
  false,
  r.created_at,
  r.created_at
from m8_legacy_play_rows r
on conflict (hand_id, client_decision_id) do nothing;

insert into public.play_decision_actions (
  decision_id, user_id, action_code, ordinal, action_label, action_kind,
  amount_bb, frequency, ev_delta_bb, ev_loss_bb, is_chosen, created_at
)
select
  md5('m8:legacy-decision:' || r.attempt_id::text)::uuid,
  r.user_id,
  coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id),
  0,
  coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id),
  case
    when upper(coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id)) = 'X' then 'check'
    when upper(coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id)) = 'F' then 'fold'
    when upper(coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id)) = 'C' then 'call'
    when upper(coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id)) like 'B%' then 'bet'
    when upper(coalesce(nullif(r.drill_payload->>'chosen', ''), r.selected_choice_id)) like 'A%' then 'all_in'
    else 'raise'
  end,
  case
    when r.phase = 'postflop' then r.legacy_amount_bb
    else null
  end,
  case
    when r.phase = 'postflop'
      and r.legacy_frequency_quantized between 0 and 255
    then r.legacy_frequency_quantized::numeric / 255
    else null
  end,
  case
    when r.phase = 'postflop'
      and r.legacy_loss_quantized between 0 and 255
    then -(r.legacy_loss_quantized::numeric * 0.05)
    else null
  end,
  case
    when r.phase = 'postflop'
      and r.legacy_loss_quantized between 0 and 255
    then r.legacy_loss_quantized::numeric * 0.05
    else null
  end,
  true,
  r.created_at
from m8_legacy_play_rows r
on conflict (decision_id, action_code) do nothing;

drop table m8_legacy_play_rows;

-- ---------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------

alter table public.play_solve_packs       enable row level security;
alter table public.play_sessions          enable row level security;
alter table public.play_hands             enable row level security;
alter table public.play_decisions         enable row level security;
alter table public.play_decision_actions  enable row level security;

create policy "solve packs readable" on public.play_solve_packs
  for select to authenticated using (true);
create policy "read own play sessions" on public.play_sessions
  for select to authenticated using (user_id = auth.uid());
create policy "read own play hands" on public.play_hands
  for select to authenticated using (user_id = auth.uid());
create policy "read own play decisions" on public.play_decisions
  for select to authenticated using (user_id = auth.uid());
create policy "read own play decision actions" on public.play_decision_actions
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.play_solve_packs from anon;
revoke all on table public.play_sessions from anon;
revoke all on table public.play_hands from anon;
revoke all on table public.play_decisions from anon;
revoke all on table public.play_decision_actions from anon;

revoke all on table public.play_solve_packs from authenticated;
revoke all on table public.play_sessions from authenticated;
revoke all on table public.play_hands from authenticated;
revoke all on table public.play_decisions from authenticated;
revoke all on table public.play_decision_actions from authenticated;

grant select on table public.play_solve_packs to authenticated;
grant select on table public.play_sessions to authenticated;
grant select on table public.play_hands to authenticated;
grant select on table public.play_decisions to authenticated;
grant select on table public.play_decision_actions to authenticated;

-- Packs are append-only even for the API role. Publishing a changed artifact
-- requires a new versioned ID; the trigger also protects owner/admin writes.
revoke all on table public.play_solve_packs from service_role;
grant select, insert on table public.play_solve_packs to service_role;
grant all privileges on table public.play_sessions to service_role;
grant all privileges on table public.play_hands to service_role;
grant all privileges on table public.play_decisions to service_role;
grant all privileges on table public.play_decision_actions to service_role;
