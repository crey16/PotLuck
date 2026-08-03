\set ON_ERROR_STOP on

begin;

-- Backfill accepts only structurally compatible legacy instances. All ten
-- fixture attempts remain in the XP log, but only five become unverified
-- archive records; none acquires the authoritative solve-pack identity.
do $$
begin
  if (select count(*) from public.attempts where drill_kind = 'play') <> 10 then
    raise exception 'fixture attempts missing';
  end if;
  if (select count(*) from public.play_decisions where attempt_id is not null) <> 5 then
    raise exception 'legacy backfill did not import exactly five compatible decisions';
  end if;
  if exists (
    select 1
    from public.play_decisions d
    join public.attempts a on a.id = d.attempt_id
    where a.drill_payload->>'retry_probe' = 'true'
  ) then
    raise exception 'duplicate legacy node retry was imported as a second grade';
  end if;
  if (select count(*) from public.play_solve_packs) <> 2
     or not exists (
       select 1 from public.play_solve_packs
       where id = 'potluck:legacy-play-attempts:v1'
         and grading_version = 'legacy-unverified:v1'
         and metadata->>'authoritative' = 'false'
     ) then
    raise exception 'legacy archive solve-pack namespace is missing';
  end if;
  if exists (
    select 1 from public.play_decisions
    where attempt_id is not null
      and solve_pack_id <> 'potluck:legacy-play-attempts:v1'
  ) or exists (
    select 1 from public.play_hands
    where deal_snapshot->>'legacy_import' = 'true'
      and solve_pack_id <> 'potluck:legacy-play-attempts:v1'
  ) or exists (
    select 1 from public.play_sessions
    where advanced_settings->>'legacy_import' = 'true'
      and solve_pack_id <> 'potluck:legacy-play-attempts:v1'
  ) then
    raise exception 'legacy client payload acquired the authoritative solve-pack identity';
  end if;
  if exists (
    select 1 from public.play_hands
    where source_hand_id like '%AcAdAh%' or source_hand_id like '%#200'
  ) then
    raise exception 'adversarial legacy payload acquired a canonical pack identity';
  end if;
  if exists (
    select 1 from public.play_decisions
    where street = 'preflop'
      and (grading_source <> 'reference' or grading_status <> 'legacy_unverified'
           or ev_basis <> 'unknown' or chosen_ev_bb is not null
           or best_ev_bb is not null or ev_loss_bb is not null)
  ) then
    raise exception 'legacy preflop row invented solver/EV information';
  end if;
  if exists (
    select 1 from public.play_decisions
    where attempt_id is not null
      and action_context->>'source_association_verified' is distinct from 'false'
  ) then
    raise exception 'legacy client payload was presented as source-verified';
  end if;
  if exists (
    select 1
    from public.play_decisions d
    join public.play_decision_actions a on a.decision_id = d.id
    where d.attempt_id is not null
      and d.action_context->'legacy_attempt_payload'->>'freq'
            in ('not-a-number', '999999999999999999999999')
      and (d.chosen_frequency is not null or d.ev_loss_bb is not null
           or a.amount_bb is not null or a.frequency is not null
           or a.ev_delta_bb is not null or a.ev_loss_bb is not null)
  ) then
    raise exception 'malformed legacy grading fields were cast or treated as trusted values';
  end if;
end;
$$;

-- Add one fully normalized native record per user for direct RLS checks.
insert into public.play_sessions (
  id, user_id, client_session_id, solve_pack_id, config_snapshot,
  solution_profile_id, solution_version, table_size, hero_positions,
  matchup_positions, starting_spot, action_family_filters, stack_depth_bb,
  rake_model, ev_model, advanced_settings
)
select
  v.session_id, v.user_id, v.client_session_id,
  'potluck:m6:srp-btn-bb:v1',
  jsonb_build_object(
    'solution_profile_id', 'cash-6max-chip-ev',
    'solution_version', 'm6-v1',
    'table_size', 6,
    'hero_positions', jsonb_build_array('BTN', 'BB'),
    'matchup_positions', jsonb_build_array('BTN', 'BB'),
    'starting_spot', 'preflop',
    'action_family_filters', jsonb_build_array('single_raised_pot'),
    'stack_depth_bb', 100,
    'rake_model', 'none',
    'ev_model', 'chip_ev',
    'advanced_settings', '{}'::jsonb
  ),
  'cash-6max-chip-ev', 'm6-v1', 6,
  array['BTN', 'BB']::text[], array['BTN', 'BB']::text[], 'preflop',
  array['single_raised_pot']::text[], 100, 'none', 'chip_ev', '{}'::jsonb
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid,
   'aaaaaaaa-1000-4000-8000-000000000001'::uuid),
  ('bbbbbbbb-0000-4000-8000-000000000001'::uuid,
   '22222222-2222-4222-8222-222222222222'::uuid,
   'bbbbbbbb-1000-4000-8000-000000000001'::uuid)
) as v(session_id, user_id, client_session_id);

insert into public.play_hands (
  id, user_id, session_id, client_hand_id, source_hand_id, solve_pack_id,
  hand_index, hero_position, opponent_positions, spot, stack_depth_bb,
  starting_street, starting_node_id, hero_cards, initial_board_cards,
  deal_snapshot
)
select
  v.hand_id, v.user_id, v.session_id, v.client_hand_id,
  'potluck:m6:srp-btn-bb:v1/' || v.source_suffix,
  'potluck:m6:srp-btn-bb:v1', 0, v.hero_position,
  array[v.opponent_position]::text[], 'srp-btn-bb', 100, 'preflop',
  'potluck:m6:srp-btn-bb:v1/' || v.source_suffix || '/preflop',
  v.hero_cards, v.board_cards,
  jsonb_build_object('fixture', true, 'snapshot_complete', true)
from (values
  ('aaaaaaaa-2000-4000-8000-000000000001'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid,
   'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
   'aaaaaaaa-3000-4000-8000-000000000001'::uuid,
   '6s5d4h#1', 'BTN', 'BB', array['As','Kd']::text[], array['6s','5d','4h']::text[]),
  ('bbbbbbbb-2000-4000-8000-000000000001'::uuid,
   '22222222-2222-4222-8222-222222222222'::uuid,
   'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
   'bbbbbbbb-3000-4000-8000-000000000001'::uuid,
   'QsQh4d#1', 'BB', 'BTN', array['7h','7d']::text[], array['Qs','Qh','4d']::text[])
) as v(hand_id, user_id, session_id, client_hand_id, source_suffix,
       hero_position, opponent_position, hero_cards, board_cards);

insert into public.play_decisions (
  id, user_id, hand_id, client_decision_id, solve_pack_id, solve_node_id,
  decision_index, position, spot, stack_depth_bb, street, board_cards,
  board_texture, hand_class, action_context, chosen_action_code,
  grading_source, grading_status, grading_version, ev_basis,
  chosen_frequency, ev_loss_bb, verdict, alternatives_complete
)
select
  v.decision_id, v.user_id, v.hand_id, v.client_decision_id,
  'potluck:m6:srp-btn-bb:v1', v.solve_node_id, 0, v.position,
  'srp-btn-bb', 100, 'flop', v.board_cards, 'test_texture', 'test_hand',
  jsonb_build_object('fixture', true), 'X', 'solver', 'validated',
  'play-grade:v1', 'relative_to_best', 0.8, 0, 'correct', true
from (values
  ('aaaaaaaa-4000-4000-8000-000000000001'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid,
   'aaaaaaaa-2000-4000-8000-000000000001'::uuid,
   'aaaaaaaa-5000-4000-8000-000000000001'::uuid,
   'potluck:m6:srp-btn-bb:v1/6s5d4h#1/root', 'BTN',
   array['6s','5d','4h']::text[]),
  ('bbbbbbbb-4000-4000-8000-000000000001'::uuid,
   '22222222-2222-4222-8222-222222222222'::uuid,
   'bbbbbbbb-2000-4000-8000-000000000001'::uuid,
   'bbbbbbbb-5000-4000-8000-000000000001'::uuid,
   'potluck:m6:srp-btn-bb:v1/QsQh4d#1/root', 'BB',
   array['Qs','Qh','4d']::text[])
) as v(decision_id, user_id, hand_id, client_decision_id, solve_node_id,
       position, board_cards);

insert into public.play_decision_actions (
  decision_id, user_id, action_code, ordinal, action_label, action_kind,
  frequency, ev_delta_bb, ev_loss_bb, is_chosen
)
values
  ('aaaaaaaa-4000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'X', 0, 'Check', 'check',
   0.8, 0, 0, true),
  ('aaaaaaaa-4000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'B18', 1, 'Bet', 'bet',
   0.2, -0.1, 0.1, false),
  ('bbbbbbbb-4000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222', 'X', 0, 'Check', 'check',
   0.8, 0, 0, true),
  ('bbbbbbbb-4000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222', 'B18', 1, 'Bet', 'bet',
   0.2, -0.1, 0.1, false);

-- Grants are deliberately read-only even before RLS is considered.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'play_solve_packs', 'play_sessions', 'play_hands',
    'play_decisions', 'play_decision_actions'
  ] loop
    if has_table_privilege('authenticated', 'public.' || table_name, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || table_name, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || table_name, 'TRUNCATE') then
      raise exception 'authenticated received a mutation grant on %', table_name;
    end if;
  end loop;
end;
$$;

do $$
begin
  if has_table_privilege('service_role', 'public.play_solve_packs', 'UPDATE')
     or has_table_privilege('service_role', 'public.play_solve_packs', 'DELETE')
     or has_table_privilege('service_role', 'public.play_solve_packs', 'TRUNCATE') then
    raise exception 'service_role can mutate an immutable solve pack';
  end if;
  begin
    update public.play_solve_packs
    set grading_version = 'tampered'
    where id = 'potluck:m6:srp-btn-bb:v1';
    raise exception 'database owner mutated an immutable solve pack';
  exception when check_violation then
    null;
  end;
  begin
    truncate table public.play_solve_packs cascade;
    raise exception 'database owner truncated the immutable solve-pack catalog';
  exception when check_violation then
    null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
begin
  if (select count(*) from public.play_sessions where id = 'aaaaaaaa-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_hands where id = 'aaaaaaaa-2000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_decisions where id = 'aaaaaaaa-4000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_decision_actions where decision_id = 'aaaaaaaa-4000-4000-8000-000000000001') <> 2 then
    raise exception 'alice cannot read her complete normalized play record';
  end if;
  if exists (select 1 from public.play_sessions where id = 'bbbbbbbb-0000-4000-8000-000000000001')
     or exists (select 1 from public.play_hands where id = 'bbbbbbbb-2000-4000-8000-000000000001')
     or exists (select 1 from public.play_decisions where id = 'bbbbbbbb-4000-4000-8000-000000000001')
     or exists (select 1 from public.play_decision_actions where decision_id = 'bbbbbbbb-4000-4000-8000-000000000001') then
    raise exception 'alice can read bob play history';
  end if;
  begin
    update public.play_sessions set last_activity_at = now()
    where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'authenticated update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $$
begin
  if (select count(*) from public.play_sessions where id = 'bbbbbbbb-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_hands where id = 'bbbbbbbb-2000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_decisions where id = 'bbbbbbbb-4000-4000-8000-000000000001') <> 1
     or (select count(*) from public.play_decision_actions where decision_id = 'bbbbbbbb-4000-4000-8000-000000000001') <> 2 then
    raise exception 'bob cannot read his complete normalized play record';
  end if;
  if exists (select 1 from public.play_sessions where id = 'aaaaaaaa-0000-4000-8000-000000000001')
     or exists (select 1 from public.play_hands where id = 'aaaaaaaa-2000-4000-8000-000000000001')
     or exists (select 1 from public.play_decisions where id = 'aaaaaaaa-4000-4000-8000-000000000001')
     or exists (select 1 from public.play_decision_actions where decision_id = 'aaaaaaaa-4000-4000-8000-000000000001') then
    raise exception 'bob can read alice play history';
  end if;
end;
$$;

reset role;

-- Terminal states require the matching timestamp and cannot be reopened or
-- changed to the other terminal state.
update public.play_hands
set status = 'completed', completed_at = now()
where id = 'aaaaaaaa-2000-4000-8000-000000000001';

update public.play_sessions
set status = 'abandoned', abandoned_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

do $$
begin
  begin
    update public.play_hands
    set status = 'abandoned', completed_at = null, abandoned_at = now()
    where id = 'aaaaaaaa-2000-4000-8000-000000000001';
    raise exception 'terminal hand status changed';
  exception when check_violation then
    null;
  end;
  begin
    update public.play_sessions
    set status = 'completed', abandoned_at = null, completed_at = now()
    where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'terminal session status changed';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.play_sessions (
      user_id, client_session_id, solve_pack_id, status, config_snapshot,
      solution_profile_id, solution_version, table_size, hero_positions,
      matchup_positions, starting_spot, stack_depth_bb, rake_model, ev_model
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-9000-4000-8000-000000000001',
      'potluck:m6:srp-btn-bb:v1', 'completed', '{}'::jsonb,
      'cash-6max-chip-ev', 'm6-v1', 6, array['BTN'], array['BB'],
      'preflop', 100, 'none', 'chip_ev'
    );
    raise exception 'completed session without completed_at was accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;

\echo 'M8 play-history migration/RLS regression checks passed'
