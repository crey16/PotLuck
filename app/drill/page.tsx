import { cookies } from "next/headers";
import { DrillShell, type Profile } from "@/components/drill/DrillShell";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { TAB_ORDER, type TabId } from "@/lib/drill/registry";
import { OPP_MODE_COOKIE, parseOppMode } from "@/components/drill/OpponentToggle";

/** Best-effort profile fetch — returns null, never throws, when Supabase is
 *  unconfigured, there is no session, or the row is missing. */
async function fetchProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, xp, level, streak_count")
    .eq("id", user.id)
    .single();
  return profile;
}

export default async function DrillPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: TabId =
    tab && (TAB_ORDER as string[]).includes(tab) ? (tab as TabId) : "mixed";
  const profile = await fetchProfile();

  // Opponent mode comes from a cookie so the first server-rendered hand already
  // respects the preference (localStorage is invisible to the server).
  const cookieStore = await cookies();
  const initialOppMode = parseOppMode(cookieStore.get(OPP_MODE_COOKIE)?.value);

  // One seed per page load. The client derives every subsequent hand from it,
  // so SSR and hydration agree on the first question.
  //
  // The react-hooks purity rule targets client components, where an impure call
  // during render makes re-renders disagree. This is a server component: it runs
  // once per request, and per-request randomness is precisely the intent — a
  // pure seed would deal every visitor the same opening hand.
  // eslint-disable-next-line react-hooks/purity
  const seed = Math.floor(Math.random() * 2 ** 31);

  return (
    <div className="wrap">
      <DrillShell
        profile={profile}
        initialTab={initialTab}
        initialOppMode={initialOppMode}
        seed={seed}
      />
    </div>
  );
}
