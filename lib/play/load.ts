/**
 * Loading and picking play-mode hands. Solve files are static assets under
 * public/solves/<spot>/ — a manifest listing the flops, then one JSON per
 * flop. Picking is pure (rng injected) with a used-set so a session never
 * replays the same scripted instance.
 */
import type { Rng } from "../poker/engine";
import { PLAY_SOLVE_PACK_FINGERPRINT } from "./constants";
import { handNotation, type PreflopPack } from "./preflop";
import type { SolveFile, SolveManifest } from "./types";

export const SPOT = "srp-btn-bb";

/**
 * Solve files live under a content-addressed path segment (M8.8C), so the URL
 * changes whenever the pack's bytes do and the assets can be served
 * `immutable`. `scripts/sync-solve-pack.mjs` publishes to the matching
 * directory and fails the build if the two ever disagree.
 */
const BASE = `/solves/${SPOT}/${PLAY_SOLVE_PACK_FINGERPRINT}`;

export async function fetchManifest(): Promise<SolveManifest> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`manifest: ${res.status}`);
  return (await res.json()) as SolveManifest;
}

/**
 * The preflop EV pack (M8.7A) — one small file for the whole spot, not one per
 * flop, because a preflop node is a strategy over 169 hands rather than
 * something that varies by board.
 *
 * Fetched rather than bundled so that grading reads the same published bytes
 * the server re-derives from. Importing the JSON into the client bundle would
 * create a second copy that a pack update could silently leave stale, which is
 * the same class of bug as two course maps.
 */
export async function fetchPreflopPack(): Promise<PreflopPack> {
  const res = await fetch(`${BASE}/preflop.json`);
  if (!res.ok) throw new Error(`preflop pack: ${res.status}`);
  const pack = (await res.json()) as PreflopPack;
  if (pack.kind !== "preflop-ev" || pack.hand_index !== "class169") {
    throw new Error("preflop pack format is not recognised");
  }
  return pack;
}

export async function fetchSolve(flop: string): Promise<SolveFile> {
  if (!/^[AKQJT2-9][shdc]/.test(flop)) throw new Error(`bad flop: ${flop}`);
  const res = await fetch(`${BASE}/${flop}.json`);
  if (!res.ok) throw new Error(`solve ${flop}: ${res.status}`);
  return (await res.json()) as SolveFile;
}

export const handId = (flop: string, index: number): string => `${flop}#${index}`;

/**
 * Pick an unused (flop, instance) pair, uniform over all instances. Bounded
 * retries; when the session has somehow consumed everything, an arbitrary
 * repeat is returned rather than spinning.
 */
export function pickHand(
  manifest: SolveManifest,
  used: ReadonlySet<string>,
  rng: Rng
): { flop: string; index: number } {
  const total = manifest.flops.reduce((a, f) => a + f.instances, 0);
  for (let tries = 0; tries < 60; tries++) {
    let n = Math.floor(rng() * total);
    for (const f of manifest.flops) {
      if (n < f.instances) {
        if (!used.has(handId(f.flop, n)) || tries === 59) {
          return { flop: f.flop, index: n };
        }
        break;
      }
      n -= f.instances;
    }
  }
  return { flop: manifest.flops[0].flop, index: 0 };
}

/**
 * Choose an instance WITHIN a fetched solve file, honouring the hero
 * position the player picked at setup (M10A).
 *
 * The hero's seat is a property of the instance, not of the flop, so it
 * cannot be known until the file is loaded — `pickHand` above chooses the
 * flop, this chooses the seat. Without it the setup screen's position
 * selector would be decoration: the player picks BTN and gets dealt the BB
 * half the time, which is precisely the "offered and then quietly
 * substituted" failure the setup model exists to prevent.
 *
 * Preferences in order: unused and the right seat; the right seat; anything.
 * The last fallback only matters once a session has exhausted a flop, and an
 * arbitrary repeat beats spinning or throwing mid-session.
 */
export function pickInstance(
  solve: SolveFile,
  used: ReadonlySet<string>,
  wantHero: 0 | 1 | null,
  rng: Rng,
  recentPreflop?: ReadonlySet<string>
): number {
  const count = solve.instances.length;
  if (count === 0) throw new Error(`solve ${solve.flop} has no instances`);
  const start = Math.floor(rng() * count);

  let seatMatch = -1;
  let unusedMatch = -1;
  for (let step = 0; step < count; step++) {
    const i = (start + step) % count;
    const instance = solve.instances[i];
    if (wantHero !== null && instance.hero !== wantHero) continue;
    if (seatMatch < 0) seatMatch = i;
    if (used.has(handId(solve.flop, i))) continue;
    if (unusedMatch < 0) unusedMatch = i;
    // M8.7C anti-repeat for preflop-only sessions. `used` alone is not
    // enough there: it is keyed by (flop, instance), and a preflop-only hand
    // never sees the flop. Six different flops dealing the hero AKs on the
    // button are six unused instances and one repeated question.
    if (recentPreflop && recentPreflop.has(preflopSignature(instance.hero, instance.hand))) {
      continue;
    }
    return i;
  }
  // Falling through means every fresh instance here repeats a recent hand
  // class. Prefer an unused one anyway — a repeated class on a new deal beats
  // replaying a scripted instance, and beats spinning.
  if (unusedMatch >= 0) return unusedMatch;
  return seatMatch >= 0 ? seatMatch : start;
}

/**
 * What a preflop-only session actually repeats: the seat and the hand class.
 *
 * Not the flop, and not the specific combo. A player drilling preflop sees
 * "button, AKs" — that AKs arrived attached to a different scripted runout is
 * invisible to them, and grading is class-indexed anyway (see preflop.ts).
 */
export const preflopSignature = (hero: 0 | 1, hand: string): string =>
  `${hero === 1 ? "BTN" : "BB"}:${handNotation(hand)}`;

/**
 * How many recent preflop spots a session remembers.
 *
 * Larger than the drills' REPEAT_WINDOW of 24 because a preflop-only session
 * burns through spots several times faster: one decision per hand with no
 * runout to play. Well below the 338 available (169 classes x 2 seats), so
 * the window narrows the sampling without distorting which hands appear.
 */
export const PREFLOP_REPEAT_WINDOW = 40;
