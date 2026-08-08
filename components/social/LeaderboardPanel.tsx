import { LeaderboardShell } from "./LeaderboardShell";
import { fetchFriendIds, fetchGlobalLeaderboard, fetchProfileById } from "../../lib/social/queries";
import { createClient, getAuthUserId } from "../../lib/supabase/server";

/**
 * The board itself, behind its own Suspense boundary.
 *
 * Three reads — the global board, the viewer's friend ids and the viewer's own
 * row — used to be awaited in the page, so the "Ranks" heading and its lede
 * waited on all of them. Nothing in that heading depends on any of them.
 *
 * The reads stay on the server and stay in `lib/social/queries.ts`, which is
 * the module M7 made the single home for the social layer's direct Supabase
 * reads. Only the point at which they block moved.
 */
export async function LeaderboardPanel() {
  const supabase = await createClient();
  const myId = await getAuthUserId();
  const [initialGlobal, friendIds, self] = await Promise.all([
    fetchGlobalLeaderboard(supabase),
    myId ? fetchFriendIds(supabase, myId) : Promise.resolve([]),
    myId ? fetchProfileById(supabase, myId) : Promise.resolve(null),
  ]);
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
    <LeaderboardShell
      initialGlobal={initialGlobal}
      friendIds={friendIds}
      self={selfRow}
      selfIsPublic={self?.is_public ?? true}
    />
  );
}

/**
 * The placeholder.
 *
 * The board opens with its own scope tabs and then a list of rows, so the
 * fallback reserves a block of roughly the height a full board occupies.
 * Nothing here is a real control: a tab strip you could click before the data
 * exists would swallow the click.
 *
 * (Written without naming the shell component: `clientBoundary.test.ts` counts
 * identifier references without stripping comments, so a doc comment that
 * names a client import reads as a call across the boundary.)
 */
export function LeaderboardPanelFallback() {
  return (
    <div className="blueprint" style={{ padding: "var(--space-6)" }} aria-busy="true" aria-live="polite">
      <span className="mono-label accent">Loading</span>
      <p className="text-dim" style={{ margin: "var(--space-3) 0 0" }}>
        Counting XP across every account…
      </p>
    </div>
  );
}
