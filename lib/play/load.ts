/**
 * Loading and picking play-mode hands. Solve files are static assets under
 * public/solves/<spot>/ — a manifest listing the flops, then one JSON per
 * flop. Picking is pure (rng injected) with a used-set so a session never
 * replays the same scripted instance.
 */
import type { Rng } from "../poker/engine";
import type { SolveFile, SolveManifest } from "./types";

export const SPOT = "srp-btn-bb";
const BASE = `/solves/${SPOT}`;

export async function fetchManifest(): Promise<SolveManifest> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`manifest: ${res.status}`);
  return (await res.json()) as SolveManifest;
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
  rng: Rng
): number {
  const count = solve.instances.length;
  if (count === 0) throw new Error(`solve ${solve.flop} has no instances`);
  const start = Math.floor(rng() * count);

  let seatMatch = -1;
  for (let step = 0; step < count; step++) {
    const i = (start + step) % count;
    if (wantHero !== null && solve.instances[i].hero !== wantHero) continue;
    if (!used.has(handId(solve.flop, i))) return i;
    if (seatMatch < 0) seatMatch = i;
  }
  return seatMatch >= 0 ? seatMatch : start;
}
