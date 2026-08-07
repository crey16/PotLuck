-- 0008_m87c_stopping_point.sql — M8.7C: how far a hand goes.
--
-- Practice ran every hand to the river. A player who wants to drill preflop
-- decisions had to play four streets to get one, which is why the fast
-- repetition loop the product was missing is the STOPPING point rather than
-- the starting one (M10A shipped the starting spot; they are independent).
--
-- Two columns, and the second is the one that matters.
--
-- play_sessions.stopping_point is part of the frozen configuration, beside
-- table_size and stack_depth_bb. It is a column rather than a key in
-- config_snapshot because M11's aggregates must be able to group by it: a
-- preflop-only session has no postflop decisions, and averaging it into a
-- "flop aggression" statistic would silently dilute that number with hands
-- that never saw a flop.
--
-- play_hands.completion_kind records HOW a hand finished. M8 already
-- distinguishes completed from abandoned; this splits completed in two:
--
--   terminal — the solve branch ended. Someone folded, or the river was shown.
--   stopped  — every decision up to the configured stopping point was made
--              and the hand was deliberately not dealt further.
--
-- Both are COMPLETE, which is the whole point. A stopped hand recorded as
-- abandoned would be excluded from every M11 coaching aggregate, and that is
-- exactly backwards: it is a full unit of practice, just a short one. But the
-- two are not interchangeable either — a stopped hand has no showdown and no
-- result, so anything reporting outcomes must be able to exclude it without
-- also excluding it from decision-quality statistics.

alter table public.play_sessions
  add column stopping_point text not null default 'river'
    check (stopping_point in ('preflop', 'flop', 'turn', 'river'));

comment on column public.play_sessions.stopping_point is
  'How far each hand in this session runs. Frozen with the rest of the configuration; M11 must group by it because a preflop-only session has no postflop decisions.';

-- Existing sessions all ran to the river, so the default is not a guess.
alter table public.play_hands
  add column completion_kind text
    check (completion_kind in ('terminal', 'stopped'));

comment on column public.play_hands.completion_kind is
  'How a completed hand finished: terminal (the solve branch ended) or stopped (it reached the session stopping point). Null while incomplete or abandoned.';

-- Every hand completed before this migration ran its solve branch to a
-- terminal — stopping early was not possible. Backfilling them as 'terminal'
-- is a statement of fact, not a default.
update public.play_hands
   set completion_kind = 'terminal'
 where status = 'completed';

-- A completed hand must say how it completed; an unfinished one must not
-- claim to have. Added after the backfill so it can be enforced rather than
-- merely documented.
alter table public.play_hands
  add constraint play_hands_completion_kind_matches_status
  check (
    (status = 'completed' and completion_kind is not null)
    or (status <> 'completed' and completion_kind is null)
  );

-- Coaching aggregates read "completed hands of this shape" constantly, and
-- M11 will need to split terminal from stopped in the same query.
create index play_hands_user_completion_idx
  on public.play_hands (user_id, completion_kind, started_at desc)
  where status = 'completed';
