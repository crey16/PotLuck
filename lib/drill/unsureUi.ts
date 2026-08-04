/**
 * Presentation constants for the "Not sure" answer (M8.5C).
 *
 * Split from `contract.ts` so a React component can import the key hint and
 * the copy without pulling the generator contract — and, more importantly, so
 * the keyboard shortcut has exactly one definition. Every surface that offers
 * "Not sure" binds the same key, and `0` is chosen because the real options
 * are always numbered from `1`, so it reads as "none of these" and can never
 * collide with an option index.
 */
export const UNSURE_KEY = "0";
export const UNSURE_KEY_HINT = "0";

/** The feedback-bar wordmark for an unsure answer. */
export const UNSURE_VERDICT = "Not sure";

/** Shown where a wrong answer would print "You picked X · answer Y". */
export const UNSURE_FEEDBACK = "No guess recorded — here is the answer and why";
