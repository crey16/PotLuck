-- Applied after 0003 and before 0004 by verify_m8_play_history.py.
-- Four rows are structurally invalid; two more carry malformed/oversized
-- optional grading fields. One repeats an inferred node to exercise conservative
-- retry de-duplication. All probe client-controlled JSON safety.

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'm8-alice@example.test', '{"username":"m8_alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'm8-bob@example.test', '{"username":"m8_bob"}');

insert into public.attempts
  (user_id, drill_kind, drill_payload, is_correct, selected_choice_id, created_at)
values
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":0,"phase":"preflop","hero":1,"hand":"AsKd","notation":"AKo","chosen":"r"}',
   true, 'r', '2026-07-31T12:00:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":0,"phase":"postflop","hero":1,"hand":"AsKd","path":"","street":0,"chosen":"X","freq":200,"loss":0}',
   true, 'X', '2026-07-31T12:00:01Z'),
  -- A legacy network retry has no client UUID and must not violate the new
  -- unique hand/node constraint or create a second grade for the same node.
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":0,"phase":"postflop","hero":1,"hand":"AsKd","path":"","street":0,"chosen":"X","freq":200,"loss":0,"retry_probe":true}',
   true, 'X', '2026-07-31T12:00:02Z'),
  ('22222222-2222-4222-8222-222222222222', 'play',
   '{"spot":"srp-btn-bb","flop":"QsQh4d","instance":199,"phase":"postflop","hero":0,"hand":"7h7d","path":"","street":0,"chosen":"F","freq":12,"loss":15}',
   false, 'F', '2026-07-31T13:00:00Z'),
  -- Regex-valid cards, but this flop is not in the immutable manifest.
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"AcAdAh","instance":0,"phase":"preflop","hero":1,"hand":"AsKd","notation":"AKo","chosen":"r"}',
   true, 'r', '2026-07-31T14:00:00Z'),
  -- A real manifest flop, but its instances end at index 199.
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":200,"phase":"preflop","hero":1,"hand":"AsKd","notation":"AKo","chosen":"r"}',
   true, 'r', '2026-07-31T15:00:00Z'),
  -- Cast-safety probes: predicate reordering must never let either value abort
  -- the migration before the conservative backfill can reject it.
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":"not-a-number","phase":"preflop","hero":1,"hand":"AsKd","notation":"AKo","chosen":"r"}',
   true, 'r', '2026-07-31T16:00:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":"999999999999999999999999999999999999999","phase":"preflop","hero":1,"hand":"AsKd","notation":"AKo","chosen":"r"}',
   true, 'r', '2026-07-31T17:00:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":1,"phase":"postflop","hero":1,"hand":"AsKd","path":"","street":0,"chosen":"Bbad","freq":"not-a-number","loss":"not-a-number"}',
   false, 'Bbad', '2026-07-31T18:00:00Z'),
  ('11111111-1111-4111-8111-111111111111', 'play',
   '{"spot":"srp-btn-bb","flop":"6s5d4h","instance":2,"phase":"postflop","hero":1,"hand":"AsKd","path":"","street":0,"chosen":"B999999999999999999999999","freq":"999999999999999999999999","loss":"999999999999999999999999"}',
   false, 'B999999999999999999999999', '2026-07-31T19:00:00Z');
