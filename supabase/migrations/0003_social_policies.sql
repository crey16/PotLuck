-- 0003_social_policies.sql — M7 core social gaps.
-- 0001 shipped the whole social schema; this fills what M7 needs:
-- a status vocabulary check, delete policies for cancel/unfriend, and
-- Realtime on profiles for the live leaderboard.

-- 1. Status vocabulary. Settled as pending|accepted|declined (0001's
--    comment said declined; StackSchool's code said rejected — declined wins).
alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'declined'));

-- 2. Cancel: a sender may delete their own pending request.
create policy "cancel own pending request" on public.friend_requests
  for delete using (from_user_id = auth.uid() and status = 'pending');

-- 3. Unfriend: either side of a friendship row may delete it.
--    (No INSERT policy on friends — deliberate. Rows are created only by
--    the FastAPI accept path, two at a time, in one transaction.)
create policy "unfriend" on public.friends
  for delete using (user_id = auth.uid() or friend_user_id = auth.uid());

-- 4. Live leaderboard: publish profile updates. postgres_changes respects
--    RLS, so private profiles' updates never reach other subscribers.
alter publication supabase_realtime add table public.profiles;
