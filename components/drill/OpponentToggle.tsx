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

/** The Unknown / Face-up segmented control from the redesign. Face-up shows
 *  the villain's hand and strips dead outs. */
export function OpponentToggle({ mode, onChange }: OpponentToggleProps) {
  return (
    <div className="seg" title="Face-up mode shows the villain's hand and strips dead outs">
      <label className="seg-opt">
        <input
          type="radio"
          name="opp"
          checked={mode === "unknown"}
          onChange={() => onChange("unknown")}
        />
        Unknown
      </label>
      <label className="seg-opt">
        <input
          type="radio"
          name="opp"
          checked={mode === "shown"}
          onChange={() => onChange("shown")}
        />
        Face-up
      </label>
    </div>
  );
}
