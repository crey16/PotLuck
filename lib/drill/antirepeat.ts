/**
 * M5 anti-repeat: a per-kind rolling window of recently seen question
 * signatures, and a generate-until-fresh wrapper around any Generator.
 *
 * Determinism is preserved because a re-roll simply continues consuming the
 * same seeded rng stream — same seed, same recent window, same final
 * question, forever. The first (server-rendered) question of a session is
 * always generated with an empty window, so SSR and hydration still agree.
 *
 * TRIES is generous because re-rolls are only ever needed for the two
 * small fixed banks (concepts: 15 items, implied's concept mode: 6). The
 * expensive generators (decision, outs — real dealt spots) have signature
 * spaces in the millions and essentially never collide, so the loop exits
 * on the first pass there.
 */
import type { DrillContext, DrillQuestion, Generator } from "./contract";

/** How many recent questions a kind remembers. */
export const REPEAT_WINDOW = 24;

const TRIES = 40;

export const questionSignature = (q: DrillQuestion): string =>
  q.signature ?? JSON.stringify(q.payload);

/**
 * Generate a question whose signature is not in `recent`, re-rolling up to
 * TRIES times. When the whole signature space is inside the window (a small
 * concept bank late in a session), the last roll is returned as-is — a
 * repeat then simply cycles the bank rather than spinning forever.
 */
export function generateFresh(
  generate: Generator,
  ctx: DrillContext,
  recent: ReadonlySet<string>
): DrillQuestion {
  let q = generate(ctx);
  for (let t = 1; t < TRIES && recent.has(questionSignature(q)); t++) {
    q = generate(ctx);
  }
  return q;
}

/**
 * Append `sig` to a rolling window, dropping any earlier occurrence and
 * trimming to `cap`. Pure — returns a new array.
 */
export function pushSignature(
  win: readonly string[],
  sig: string,
  cap = REPEAT_WINDOW
): string[] {
  const out = win.filter((s) => s !== sig);
  out.push(sig);
  return out.slice(-cap);
}
