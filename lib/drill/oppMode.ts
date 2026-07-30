import type { OppMode } from "./contract";

/**
 * The opponent mode is persisted in a COOKIE rather than localStorage, on
 * purpose: the drill page is server-rendered and the dealt spot depends on the
 * mode (face-up deals a villain). localStorage is unreadable during SSR, so a
 * user who had chosen face-up would be served an unknown-mode hand on every
 * fresh load and only see their preference take effect on the second hand. A
 * cookie is readable in the server component, so the very first hand is right.
 *
 * These two live here, outside any `"use client"` module, precisely because
 * BOTH sides need them: the server component parses the cookie during render,
 * the toggle writes it in the browser. Exporting them from the client
 * component instead type-checks, lints and builds clean, then fails at request
 * time with "Attempted to call parseOppMode() from the server". See
 * `components/drill/clientBoundary.test.ts`.
 */
export const OPP_MODE_COOKIE = "hcwk_opp";

/** Parse the mode out of a raw Cookie header value or a cookie store value. */
export function parseOppMode(value: string | undefined): OppMode {
  return value === "shown" ? "shown" : "unknown";
}
