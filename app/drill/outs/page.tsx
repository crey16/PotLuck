import { Header } from "@/components/ui/Header";
import { OutsDrill } from "@/components/drill/OutsDrill";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

interface Profile {
  username: string;
  xp: number;
  level: number;
  streak_count: number;
}

/**
 * Best-effort profile fetch. Returns null (never throws) whenever Supabase
 * isn't configured, there's no session, or the profile row doesn't exist
 * yet — the drill renders exactly as it does unauthenticated in every one
 * of those cases. This is the RLS "read own profile" path end to end once
 * credentials exist.
 */
async function fetchProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, xp, level, streak_count")
    .eq("id", user.id)
    .single();

  return profile;
}

/** Thin server component for the "Count your outs" drill. */
export default async function OutsDrillPage() {
  const profile = await fetchProfile();

  return (
    <div className="wrap">
      <Header
        username={profile?.username}
        xp={profile?.xp}
        level={profile?.level}
        streak={profile?.streak_count}
      />
      <OutsDrill level={profile?.level} />
    </div>
  );
}
