-- M8.5C: "Not sure" as a first-class answer.
--
-- Every drill was multiple choice with no way to say "I don't know", so a
-- lucky guess and real knowledge were stored identically and a shrug was
-- indistinguishable from a confident wrong belief. Those two mean opposite
-- things to a coach — one is a gap to fill, the other a belief to correct —
-- and M11's weakness detection has to separate them.
--
-- An unsure attempt is still `is_correct = false`. This column records WHY,
-- and it is a column rather than a key in drill_payload because lesson and
-- scenario attempts carry no payload at all, and because analytics must be
-- able to filter on it without unpacking JSON.

alter table public.attempts
  add column response_type text not null default 'answer'
  check (response_type in ('answer', 'unsure'));

comment on column public.attempts.response_type is
  'answer = the player committed to a choice; unsure = the player said they did not know (M8.5C). Unsure attempts are graded incorrect but are excluded from adaptive-difficulty windows.';

-- The adaptive-difficulty window (api/index.py DRILL_STATE_SQL) reads the most
-- recent rows per drill kind and now skips unsure ones, matching the client
-- rule in lib/drill/difficulty.ts::pushOutcome. Without this partial index the
-- filter turns that per-kind top-N scan into a filtered sort over every
-- attempt the user has ever made.
create index attempts_drill_window_idx
  on public.attempts (user_id, drill_kind, created_at desc, id desc)
  where drill_kind is not null and response_type = 'answer';

-- Kept alongside total/correct rather than derived, so a skill's accuracy and
-- its "how often did they not know" signal are one row read. total_attempts
-- still counts unsure attempts: they are misses, and hiding them would make
-- accuracy read better than the player's actual command of the skill.
alter table public.skill_stats
  add column unsure_attempts integer not null default 0;

comment on column public.skill_stats.unsure_attempts is
  'Subset of total_attempts the player answered "Not sure" (M8.5C). Never counted in correct_attempts.';
