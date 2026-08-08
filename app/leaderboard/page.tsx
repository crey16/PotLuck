import { Suspense } from "react";
import {
  LeaderboardPanel,
  LeaderboardPanelFallback,
} from "@/components/social/LeaderboardPanel";
import { supabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Ranks — PotLuck" };

/**
 * The heading renders immediately; the board streams in behind it.
 *
 * `supabaseConfigured()` is a synchronous env check, so it stays in the page —
 * it decides whether there is a board to wait for at all, and putting it
 * behind the boundary would show a loading state that resolves into "no
 * accounts configured".
 */
export default function LeaderboardPage() {
  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      <div className="section-head">
        <h1 style={{ fontSize: 40, lineHeight: 1 }}>Ranks</h1>
        <span className="lede">
          Live — the board moves as XP lands. Public profiles only; friends
          boards include private friends.
        </span>
      </div>
      {supabaseConfigured() ? (
        <Suspense fallback={<LeaderboardPanelFallback />}>
          <LeaderboardPanel />
        </Suspense>
      ) : (
        <p className="text-dim">Supabase is not configured — no leaderboard without accounts.</p>
      )}
    </main>
  );
}
