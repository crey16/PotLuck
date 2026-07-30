"use client";

import type { OppMode } from "@/lib/drill/contract";
import { OPP_MODE_COOKIE } from "@/lib/drill/oppMode";

/** Persist the mode for a year. No-ops if cookies are unavailable. */
export function writeOppModeCookie(mode: OppMode): void {
  try {
    document.cookie = `${OPP_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked — the toggle still works for this session */
  }
}

export interface OpponentToggleProps {
  mode: OppMode;
  onChange: (mode: OppMode) => void;
}

export function OpponentToggle({ mode, onChange }: OpponentToggleProps) {
  return (
    <button
      className="tab"
      onClick={() => onChange(mode === "unknown" ? "shown" : "unknown")}
      title="Face-up mode shows the villain's hand and strips dead outs"
    >
      Opponent: <b>{mode === "shown" ? "face-up" : "unknown"}</b>
    </button>
  );
}
