-- 0009_m87c_completion_kind_constraint.sql — the second half of M8.7C.
--
-- RUN THIS AFTER THE M8.7 CODE IS DEPLOYED, not before.
--
-- 0008 added `play_hands.completion_kind` and backfilled it, but deliberately
-- left it unconstrained. This adds the invariant: a completed hand must say
-- HOW it completed, and an unfinished one must not claim to have.
--
-- Why the split. The code that writes `completion_kind` ships with M8.7C.
-- Applying this constraint while the previous release is still serving
-- traffic would reject every hand a player finished in the gap — the old
-- `update_play_hand_status` sets status = 'completed' and writes no
-- completion_kind, so the CHECK would fail on the one action that closes a
-- hand. Expand first, constrain after: the standard order, and the reason it
-- exists.
--
-- Safe to run twice: it no-ops if the constraint is already present.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'play_hands_completion_kind_matches_status'
      and conrelid = 'public.play_hands'::regclass
  ) then
    -- Guard the pre-condition rather than letting the ALTER fail with a
    -- generic message: if any completed hand is still missing its kind, the
    -- deploy has not landed (or a write slipped through the gap), and THAT
    -- is what needs fixing — not this migration.
    if exists (
      select 1 from public.play_hands
      where status = 'completed' and completion_kind is null
    ) then
      raise exception
        'refusing to constrain: % completed hand(s) have no completion_kind. '
        'Deploy the M8.7C code first, then backfill them as ''terminal'' — a '
        'hand completed by the old code did run its solve branch to a terminal.',
        (select count(*) from public.play_hands
          where status = 'completed' and completion_kind is null);
    end if;

    alter table public.play_hands
      add constraint play_hands_completion_kind_matches_status
      check (
        (status = 'completed' and completion_kind is not null)
        or (status <> 'completed' and completion_kind is null)
      );
  end if;
end
$$;
