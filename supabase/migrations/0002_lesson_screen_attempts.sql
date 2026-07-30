-- M4: retain the authored screen behind each lesson answer so completion
-- and first-try score can be verified entirely from server-graded attempts.

alter table public.attempts
  add column lesson_screen_index integer
  check (lesson_screen_index is null or lesson_screen_index >= 0);

create index attempts_lesson_screen_idx
  on public.attempts
    (user_id, lesson_id, lesson_screen_index, created_at, id)
  where lesson_id is not null and lesson_screen_index is not null;
