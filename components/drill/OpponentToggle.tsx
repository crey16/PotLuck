"use client";

import type { OppMode } from "@/lib/drill/contract";

/**
 * The opponent mode is persisted in a COOKIE rather than localStorage, on
 * purpose: the drill page is server-rendered and the dealt spot depends on the
 * mode (face-up deals a villain). localStorage is unreadable during SSR, so a
 * user who had chosen face-up would be served an unknown-mode hand on every
 * fresh load and only see their preference take effect on the second hand. A
 * cookie is readable in the server component, so the very first hand is right.
 */
export const OPP_MODE_COOKIE = "hcwk_opp";

/** Parse the mode out of a raw Cookie header value or a cookie store value. */
export function parseOppMode(value: string | undefined): OppMode {
  return value === "shown" ? "shown" : "unknown";
}

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
