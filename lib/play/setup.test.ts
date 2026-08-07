import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_FAMILY_LABEL,
  DEFAULT_CONFIG,
  SIX_MAX_POSITIONS,
  STOPPING_POINT_LABEL,
  SUPPORT,
  TABLE_SIZE_LABEL,
  playablePositions,
  solveAssumptions,
  validateConfig,
  type ActionFamily,
  type PracticeConfig,
  stoppingStreetIndex,
  type StoppingPoint,
  type TableSize,
} from "./setup";
import { PLAY_SOLVE_PACK_ID } from "./constants";
import { DEFAULT_PLAY_CONFIGURATION } from "./api";

const TABLE_SIZES = Object.keys(SUPPORT.tableSize).map(Number) as TableSize[];
const FAMILIES = Object.keys(SUPPORT.actionFamily) as ActionFamily[];
const STOPS = Object.keys(SUPPORT.stoppingPoint) as StoppingPoint[];

/**
 * The rule the whole module exists for. An option that is offered and then
 * disabled must say why — a greyed-out control with no explanation is
 * indistinguishable from a bug, and the player cannot tell a missing feature
 * from a missing option.
 */
test("setup: every unavailable option carries a reason", () => {
  const groups: [string, Record<string, { available: boolean; reason?: string }>][] = [
    ["tableSize", SUPPORT.tableSize],
    ["heroPosition", SUPPORT.heroPosition],
    ["actionFamily", SUPPORT.actionFamily],
    ["stoppingPoint", SUPPORT.stoppingPoint],
  ];
  for (const [group, options] of groups) {
    for (const [key, availability] of Object.entries(options)) {
      if (availability.available) continue;
      assert.ok(
        availability.reason && availability.reason.length > 20,
        `${group}.${key} is disabled with no usable reason`
      );
      assert.match(
        availability.reason!,
        /\.$/,
        `${group}.${key}'s reason should read as a sentence`
      );
    }
  }
});

test("setup: every option in the vocabulary has an availability entry", () => {
  // A missing entry would read as `undefined` and crash the control rather
  // than disabling it.
  for (const p of SIX_MAX_POSITIONS) {
    assert.ok(SUPPORT.heroPosition[p], `no availability for position ${p}`);
    assert.ok(TABLE_SIZE_LABEL, "labels exist");
  }
  for (const f of FAMILIES) assert.ok(ACTION_FAMILY_LABEL[f], `no label for family ${f}`);
  for (const s of STOPS) assert.ok(STOPPING_POINT_LABEL[s], `no label for stop ${s}`);
  for (const t of TABLE_SIZES) assert.ok(TABLE_SIZE_LABEL[t], `no label for table size ${t}`);
});

test("setup: the default configuration is the one that actually ships", () => {
  const result = validateConfig(DEFAULT_CONFIG);
  assert.equal(result.ok, true, `default config is invalid: ${result.problems.join(" ")}`);
});

/**
 * The setup screen and the session record the API writes must describe the
 * same practice. If they drift, a stored session says one thing and the
 * screen said another.
 */
test("setup: the default agrees with the configuration sent to the API", () => {
  assert.equal(DEFAULT_CONFIG.tableSize, DEFAULT_PLAY_CONFIGURATION.table_size);
  // Widened to string[]: the API literal types are frozen to today's single
  // configuration, and the point of this check is that the two agree, not
  // that TypeScript already proved they must.
  const apiPositions: string[] = [...DEFAULT_PLAY_CONFIGURATION.hero_positions];
  const apiFamilies: string[] = [...DEFAULT_PLAY_CONFIGURATION.action_family_filters];
  assert.ok(
    apiPositions.includes(DEFAULT_CONFIG.heroPosition),
    "the default hero position is not one the API session declares"
  );
  assert.ok(
    apiFamilies.includes(DEFAULT_CONFIG.actionFamily),
    "the default action family is not one the API session declares"
  );
});

test("setup: only BTN and BB are playable today, and both validate", () => {
  assert.deepEqual(playablePositions(), ["BTN", "BB"]);
  for (const heroPosition of playablePositions()) {
    const config: PracticeConfig = { ...DEFAULT_CONFIG, heroPosition };
    assert.equal(validateConfig(config).ok, true, `${heroPosition} should be playable`);
  }
});

test("setup: an unsupported choice blocks Start Training and explains itself", () => {
  const config: PracticeConfig = { ...DEFAULT_CONFIG, heroPosition: "UTG" };
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /^UTG: /);
  assert.match(result.problems[0], /BTN-versus-BB/);
});

test("setup: several unsupported choices are all reported, not just the first", () => {
  const config: PracticeConfig = {
    tableSize: 2,
    heroPosition: "SB",
    actionFamily: "squeeze",
    stoppingPoint: "preflop",
    stackDepth: 10,
  };
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  // Four: table size, seat, action family and stack depth. The stopping point
  // is supported now (M8.7C), so it is no longer one of them.
  assert.equal(result.problems.length, 4, "a player fixing one at a time learns nothing");
});

/**
 * Preflop-only practice is the headline M8.7C feature, and it shipped once
 * its two blockers cleared: preflop graded from solver EVs (M8.7A), and the
 * server able to record a stopped hand as COMPLETE rather than abandoned.
 *
 * The second is the one to re-check if this ever regresses. An abandoned hand
 * is excluded from every M11 coaching aggregate, so a preflop-only session
 * quietly recorded that way would vanish from the player's own statistics
 * while still appearing to work on screen.
 */
test("setup: every stopping point is offered, and none carries a reason", () => {
  for (const point of ["preflop", "flop", "turn", "river"] as StoppingPoint[]) {
    assert.equal(SUPPORT.stoppingPoint[point].available, true, point);
    assert.equal(SUPPORT.stoppingPoint[point].reason, undefined, point);
  }
});

test("setup: the stopping point maps onto the solve pack's own street numbers", () => {
  // Must match `stopping_street_index` in api/play_solver.py. The server
  // decides whether a hand may complete with this arithmetic, so a client
  // that disagreed would offer a hand the server then refuses to close.
  assert.equal(stoppingStreetIndex("preflop"), -1);
  assert.equal(stoppingStreetIndex("flop"), 0);
  assert.equal(stoppingStreetIndex("turn"), 1);
  assert.equal(stoppingStreetIndex("river"), 2);
});

test("setup: a preflop-only configuration validates", () => {
  const result = validateConfig({
    tableSize: 6,
    heroPosition: "BTN",
    actionFamily: "single_raised_pot",
    stoppingPoint: "preflop",
    stackDepth: 100,
  });
  assert.equal(result.ok, true, result.problems.join(" "));
});

/**
 * The multiway families are outside the solved game by design, not merely
 * unimplemented. Their reasons must not promise them "soon".
 */
test("setup: multiway families are refused as out of model, not as coming soon", () => {
  for (const family of ["squeeze", "limped", "isolate"] as ActionFamily[]) {
    const availability = SUPPORT.actionFamily[family];
    assert.equal(availability.available, false);
    assert.match(availability.reason!, /multiway/);
    assert.doesNotMatch(
      availability.reason!,
      /yet|soon|coming/i,
      `${family} is pruned from the solve by design — its reason must not imply it is pending`
    );
  }
});

test("setup: heads-up is refused as its own game rather than as a smaller table", () => {
  assert.match(SUPPORT.tableSize[2].reason!, /different game/);
});

test("setup: the solve assumptions name the pack and state its limits", () => {
  const assumptions = solveAssumptions(PLAY_SOLVE_PACK_ID);
  assert.equal(assumptions.packId, PLAY_SOLVE_PACK_ID);
  assert.ok(assumptions.lines.length >= 5);
  for (const line of assumptions.lines) {
    assert.ok(line.label.length > 0 && line.value.length > 0);
  }
  // The four things that must never be left implicit wherever the product
  // says "GTO".
  const limits = assumptions.limits.join(" ");
  // M8.7A replaced "graded against reference ranges" with a sharper caveat:
  // preflop IS solved now, but it is the equilibrium of a tree where BB
  // cannot 3-bet, so the ranges are much wider than a real button range.
  // Presenting them as "how to open the button" is the failure to avoid.
  assert.match(limits, /never 3-bets|no 3-bet/i, "the pruned preflop tree must be disclosed");
  assert.doesNotMatch(
    limits,
    /reference ranges/,
    "preflop is graded from solver EVs now; the old disclosure would be untrue"
  );
  assert.match(
    limits,
    /sampling error|averaged over/i,
    "the precision of the preflop EVs must be disclosed"
  );
  assert.match(limits, /one bet size|One bet size/, "sizing limitation must be disclosed");
  assert.match(limits, /multiway/, "the multiway exclusion must be disclosed");
});

test("setup: the stated stack depth matches the session record", () => {
  const stacks = solveAssumptions(PLAY_SOLVE_PACK_ID).lines.find((l) => l.label === "Stacks");
  assert.ok(stacks);
  assert.match(
    stacks!.value,
    new RegExp(String(DEFAULT_PLAY_CONFIGURATION.stack_depth_bb)),
    "the assumptions panel and the stored session disagree about stack depth"
  );
});
