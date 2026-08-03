import { LeaderboardShell } from "@/components/social/LeaderboardShell";
import {
  fetchFriendIds,
  fetchGlobalLeaderboard,
  fetchProfileById,
} from "@/lib/social/queries";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Ranks — PotLuck" };

export default async function LeaderboardPage() {
  if (!supabaseConfigured()) {
    return (
      <main className="page" style={{ paddingTop: "var(--space-8)" }}>
        <p className="text-dim">Supabase is not configured — no leaderboard without accounts.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const myId = await getAuthUserId();
  const [initialGlobal, friendIds, self] = await Promise.all([
    fetchGlobalLeaderboard(supabase),
    myId ? fetchFriendIds(supabase, myId) : Promise.resolve([]),
    myId ? fetchProfileById(supabase, myId) : Promise.resolve(null),
  ]);
  const selfIsPublic = self?.is_public ?? true;
  const selfRow = self
    ? {
        id: self.id,
        username: self.username,
        display_name: self.display_name,
        level: self.level,
        streak_count: self.streak_count,
        xp: self.xp,
      }
    : null;

  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      <div className="section-head">
        <h1 style={{ fontSize: 40, lineHeight: 1 }}>Ranks</h1>
        <span className="lede">
          Live — the board moves as XP lands. Public profiles only; friends
          boards include private friends.
        </span>
      </div>
      <LeaderboardShell
        initialGlobal={initialGlobal}
        friendIds={friendIds}
        self={selfRow}
        selfIsPublic={selfIsPublic}
      />
    </main>
  );
}
