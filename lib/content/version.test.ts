import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CONTENT_VERSION,
  PUBLIC_CONTENT_MAX_AGE_SECONDS,
  SEED_FINGERPRINT,
  contentVersion,
  publicContentKeyParts,
} from "./version";

/**
 * Guards M8.8C: the public-content cache key must change whenever the content
 * can have changed.
 *
 * A cache is only as correct as its key. These tests hold the two halves of
 * the version contract to their sources — the seed file and `api/learning.py`
 * — so that neither can drift into "cached forever under a key that no longer
 * describes the data", which is the failure mode a caching change is
 * supposed to be most afraid of.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SEED = path.join(ROOT, "supabase", "seed.sql");

const fingerprintOf = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

test("SEED_FINGERPRINT is the current hash of supabase/seed.sql", () => {
  const actual = fingerprintOf(readFileSync(SEED));
  assert.equal(
    SEED_FINGERPRINT,
    actual,
    `supabase/seed.sql changed but SEED_FINGERPRINT did not. Set it to "${actual}" in ` +
      "lib/content/version.ts — otherwise the shared content cache keeps serving the old course."
  );
});

test("the fingerprint actually moves when the seed does", () => {
  // Mutation test. Without this, a fingerprint accidentally computed over a
  // constant — or over the wrong file — would pass the check above forever.
  const seed = readFileSync(SEED, "utf8");
  const edited = `${seed}\n-- one more comment\n`;
  assert.notEqual(fingerprintOf(edited), SEED_FINGERPRINT);
});

test("supabase/seed.sql is the only file that ships content rows", () => {
  // The fingerprint covers one file, so the claim that it covers ALL content
  // has to be enforced rather than assumed. If content ever starts shipping in
  // a migration, this fails and the version contract must grow to match.
  const CONTENT_TABLES = [
    "modules",
    "lessons",
    "scenarios",
    "table_scenarios",
    "daily_content",
  ];
  const dirs = [
    path.join(ROOT, "supabase"),
    path.join(ROOT, "supabase", "migrations"),
  ];
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".sql")) continue;
      const file = path.join(dir, entry);
      const relative = path.relative(ROOT, file);
      if (relative === path.join("supabase", "seed.sql")) continue;
      const sql = readFileSync(file, "utf8").toLowerCase();
      for (const table of CONTENT_TABLES) {
        // `insert into public.lessons` / `insert into lessons`, in any spacing.
        const pattern = new RegExp(`insert\\s+into\\s+(?:public\\.)?${table}\\b`);
        if (pattern.test(sql)) offenders.push(`${relative} -> ${table}`);
      }
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    "content is shipping outside supabase/seed.sql, so SEED_FINGERPRINT no longer covers it"
  );
});

test("CONTENT_VERSION matches the value api/learning.py publishes", () => {
  const python = readFileSync(path.join(ROOT, "api", "learning.py"), "utf8");
  const declared = /^CONTENT_VERSION\s*=\s*(\d+)\s*$/m.exec(python)?.[1];
  assert.ok(declared !== undefined, "api/learning.py no longer declares CONTENT_VERSION");
  assert.equal(
    CONTENT_VERSION,
    Number(declared),
    "the TypeScript and Python content versions disagree — GET /api/content/version would " +
      "advertise one number while the cache keys on another"
  );
});

test("the cache key carries both dimensions", () => {
  const parts = publicContentKeyParts();
  assert.ok(parts.some((part) => part.includes(SEED_FINGERPRINT)), "seed fingerprint missing");
  assert.ok(parts.some((part) => part === `content:${contentVersion()}`), "content version missing");
});

test("a different content version produces a different key", () => {
  const before = publicContentKeyParts().join("|");
  const original = process.env.CONTENT_VERSION;
  try {
    process.env.CONTENT_VERSION = String(contentVersion() + 1);
    const after = publicContentKeyParts().join("|");
    assert.notEqual(after, before);
    assert.ok(after.includes(`content:${CONTENT_VERSION + 1}`));
  } finally {
    if (original === undefined) delete process.env.CONTENT_VERSION;
    else process.env.CONTENT_VERSION = original;
  }
});

test("a malformed CONTENT_VERSION falls back instead of keying on NaN", () => {
  const original = process.env.CONTENT_VERSION;
  try {
    for (const bad of ["", "abc", "0", "-3", "1.5"]) {
      process.env.CONTENT_VERSION = bad;
      assert.equal(
        contentVersion(),
        CONTENT_VERSION,
        `"${bad}" should be ignored, not turned into a key`
      );
      assert.ok(!publicContentKeyParts().join("|").includes("NaN"));
    }
  } finally {
    if (original === undefined) delete process.env.CONTENT_VERSION;
    else process.env.CONTENT_VERSION = original;
  }
});

test("the TTL is a backstop, not the invalidation mechanism", () => {
  // Bounded so an out-of-band database edit cannot go unnoticed indefinitely,
  // but long enough that it is clearly not doing the versioning job. A value
  // under a minute would mean the version contract had quietly been replaced
  // by polling.
  assert.ok(PUBLIC_CONTENT_MAX_AGE_SECONDS >= 300);
  assert.ok(PUBLIC_CONTENT_MAX_AGE_SECONDS <= 86400);
});
