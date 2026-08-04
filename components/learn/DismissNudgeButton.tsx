"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NUDGE_DISMISSED_COOKIE } from "@/lib/learn/nudge";

/**
 * Writes the dismissal cookie, then refreshes so the server stops rendering
 * the banner.
 *
 * `router.refresh()` rather than local state: the banner is decided on the
 * server from the cookie, so hiding it only in the client would leave the two
 * disagreeing — the next server render would bring it back. Optimistically
 * hidden first so the click feels immediate rather than waiting on the refetch.
 */
export function DismissNudgeButton() {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);

  function dismiss() {
    setHidden(true);
    try {
      document.cookie = `${NUDGE_DISMISSED_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked — it will simply reappear next load */
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      className="start-here-dismiss"
      onClick={dismiss}
      disabled={hidden}
    >
      Dismiss
    </button>
  );
}
