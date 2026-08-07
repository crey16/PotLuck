-- 0007_m87a_preflop_solver_pack.sql — M8.7A: preflop graded from solver EVs.
--
-- `/play` graded preflop against the hand-authored reference ranges in
-- lib/poker/ranges.ts, which carry frequencies and no EVs at all.  Every
-- preflop decision was therefore stored with ev_loss_bb null and excluded from
-- the GTO score.  The pack now ships solved preflop EVs, so a preflop decision
-- is graded in big blinds like any postflop one.
--
-- WHY A NEW PACK ROW RATHER THAN AN UPDATE.  play_solve_packs is immutable by
-- trigger, and api/play.py refuses to open a session whose catalog row
-- disagrees with the server artifact.  Adding preflop.json to the content hash
-- changes the artifact, so it must be a new id — otherwise every session
-- creation would 409 the moment the code deployed.  That is the immutability
-- discipline working, not an obstacle to route around.
--
-- HISTORY IS NOT REWRITTEN.  Rows written under potluck:m6:srp-btn-bb:v1 keep
-- their pack id, their reference-graded preflop verdicts and their null EVs.
-- They stay excluded from EV aggregates exactly as before; nothing is
-- retroactively restated, which is the same rule M8 applies to the legacy
-- attempt archive.  The postflop solve files are byte-identical between the
-- two packs, so a hand dealt under v1 still resolves to the same instance —
-- api/play_solver.py parses both ids and mints only the new one.

insert into public.play_solve_packs
  (id, solution_profile_id, solution_version, spot, format_version,
   grading_version, content_hash, metadata, published_at)
values
  (
    'potluck:m87a:srp-btn-bb:v2',
    'cash-6max-chip-ev',
    'm87a-v1',
    'srp-btn-bb',
    1,
    'play-grade:v2',
    'sha256:86901bebdba8356ac3ff34e5e31a5db052aacc4f91a563a9008a00b97fdcb15e',
    jsonb_build_object(
      'manifest', '/solves/srp-btn-bb/index.json',
      'catalog', '/solves/srp-btn-bb/catalog.json',
      'preflop', '/solves/srp-btn-bb/preflop.json',
      'starting_pot_bb', 5.5,
      'stack_behind_bb', 97.5,
      'effective_stack_bb', 100,
      'rake_model', 'none',
      'ev_model', 'chip_ev',
      -- Postflop still exports EV LOSS against the best action and no
      -- absolute node EV; preflop exports genuine absolutes.  Recorded
      -- separately because docs/15's standing rule is that inferring a
      -- postflop absolute by addition would be a fiction with a decimal point.
      'absolute_action_ev_available', false,
      'preflop_absolute_action_ev_available', true,
      'preflop_grading_version', 'solver-preflop-ev:v1',
      'preflop_hand_index', 'class169',
      'preflop_iteration', 4,
      'preflop_flops_averaged', 25,
      -- The measured precision of the published EVs.  Grading subtracts this
      -- per-hand standard error before banding, so a choice inside the noise
      -- is not recorded as a mistake.  A denser solve lowers it; the stored
      -- value on each decision is what keeps historical grades re-derivable.
      'preflop_median_standard_error_mbb', 316,
      'preflop_excludes', jsonb_build_array(
        'BB cannot 3-bet in this solve, so the equilibrium is far wider than a real 6-max button range.',
        'The small blind is dead money that always folds.',
        'One open size only, so sizing is not part of the solved strategy.',
        'Strategies are pure per hand: a best response to fixed EVs does not mix.'
      )
    ),
    '2026-08-07T00:00:00Z'::timestamptz
  );
