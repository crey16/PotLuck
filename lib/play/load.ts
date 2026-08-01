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
