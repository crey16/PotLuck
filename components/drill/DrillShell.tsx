"use client";

import { useCallback, useRef, useState } from "react";
import { Header } from "@/components/ui/Header";
import { OutsDrill, type OutsDrillResult } from "@/components/drill/OutsDrill";
import { recordAttempt } from "@/lib/drill/recordAttempt";

export interface Profile {
  username: string;
  xp: number;
  level: number;
  streak_count: number;
}

export interface DrillShellProps {
  /** Server-fetched initial profile (fail-soft — null when signed out / unconfigured). */
  profile: Profile | null;
}

/**
 * Client wrapper around the "Count your outs" drill: holds profile state,
 * renders Header + OutsDrill, and posts each result to the FastAPI attempts
 * endpoint via recordAttempt. Updates header XP/level/streak from the
 * response — no refetch. Never blocks the drill's feedback UI on the POST;
 * recordAttempt fails soft (returns null) whenever Supabase is unconfigured,
 * there's no session, or the request fails, so a rejected/unresolved promise
 * never surfaces here.
 */
export function DrillShell({ profile: initialProfile }: DrillShellProps) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  // Monotonic counter guarding against out-of-order recordAttempt responses:
  // each request captures the counter value at issue time, and only the
  // response matching the latest issued request is applied to state.
  const latestRequestId = useRef(0);

  const handleResult = useCallback((result: OutsDrillResult) => {
    const requestId = ++latestRequestId.current;
    void recordAttempt(result).then((update) => {
      if (!update) return;
      if (requestId !== latestRequestId.current) return;
      setProfile({
        username: update.username,
        xp: update.xp,
        level: update.level,
        streak_count: update.streak_count,
      });
    });
  }, []);

  return (
    <>
      <Header
        username={profile?.username}
        xp={profile?.xp}
        level={profile?.level}
        streak={profile?.streak_count}
      />
      <OutsDrill level={profile?.level} onResult={handleResult} />
    </>
  );
}
