/**
 * The press-and-hold password reveal, as pure logic.
 *
 * Hold rather than toggle: a toggled password stays on screen until something
 * turns it off, and the thing that usually turns it off is the player noticing.
 * Holding means the exposure ends when the finger does.
 *
 * The state machine lives here rather than inside the component for the same
 * reason `lib/learn/nudge.ts` does: the interesting part is which events end a
 * reveal, and that is worth testing without a DOM. There is no React in this
 * file, so it is safe to import from either side of the client boundary.
 */

/** Keys that start a reveal while the control is focused. */
const REVEAL_KEYS = new Set([" ", "Spacebar", "Enter"]);

export function isRevealKey(key: string): boolean {
  return REVEAL_KEYS.has(key);
}

/**
 * Everything that can change the reveal.
 *
 * Every event except `press` ends it. That is deliberate and is the whole
 * safety argument: any way of losing the control — releasing, dragging off it,
 * a cancelled touch, tabbing away, the window going to the background — must
 * put the password back. A new event type added later defaults to hiding.
 */
export type HoldEvent =
  | "press"
  | "release"
  | "leave"
  | "cancel"
  | "blur"
  | "hide";

export function nextRevealed(event: HoldEvent): boolean {
  return event === "press";
}

/** The input's `type`. Kept here so the component cannot invert it by mistake. */
export function inputType(revealed: boolean): "text" | "password" {
  return revealed ? "text" : "password";
}

/**
 * The control's accessible name. It never contains the password, and it says
 * what holding does rather than reporting state — a screen-reader user needs
 * the affordance, and `aria-pressed` would describe a toggle this is not.
 */
export function revealLabel(revealed: boolean): string {
  return revealed ? "Password shown while held" : "Hold to show password";
}
