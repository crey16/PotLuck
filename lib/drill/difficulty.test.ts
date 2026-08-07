import test from "node:test";
import assert from "node:assert/strict";
import { nextLevel, pushResult, pushOutcome, emptyWindows, levelFromHistory, mergeSeededWindows, seededLevels, WINDOW_SIZE, MIN_SAMPLE, levelWithPlacementFloor, mixedLevelFrom, type Levels } from "./difficulty";
import { DRILL_KINDS, type DrillLevel } from "./contract";
import { mulberry32 } from "./rng";

const rep = (n: number, v: boolean) => Array.from({ length: n }, () => v);

test("nextLevel: fewer than 6 results leaves the level alone", () => {
  assert.equal(nextLevel(rep(5, true), 1), 1);
  assert.equal(nextLevel(rep(5, false), 3), 3);
  assert.equal(nextLevel([], 2), 2);
});

test("nextLevel: 6 results is enough to move", () => {
  assert.equal(nextLevel(rep(6, true), 1), 2);
});

test("nextLevel: exactly 80% promotes (boundary is inclusive)", () => {
  // 8 of 10 = 0.80
  assert.equal(nextLevel([...rep(8, true), ...rep(2, false)], 1), 2);
});

test("nextLevel: just under 80% does not promote", () => {
  // 7 of 10 = 0.70
  assert.equal(nextLevel([...rep(7, true), ...rep(3, false)], 1), 1);
});

test("nextLevel: exactly 50% does NOT demote (boundary is exclusive)", () => {
  // 5 of 10 = 0.50
  assert.equal(nextLevel([...rep(5, true), ...rep(5, false)], 2), 2);
});

test("nextLevel: below 50% demotes", () => {
  // 4 of 10 = 0.40
  assert.equal(nextLevel([...rep(4, true), ...rep(6, false)], 2), 1);
});

test("nextLevel: promotion caps at 3 and demotion floors at 1", () => {
  assert.equal(nextLevel(rep(10, true), 3), 3);
  assert.equal(nextLevel(rep(10, false), 1), 1);
});

test("nextLevel: only the last 10 results count", () => {
  // 20 wrong then 10 right: accuracy over the window is 1.0
  const window = [...rep(20, false), ...rep(10, true)];
  assert.equal(nextLevel(window, 1), 2);
});

test("pushResult: appends and caps the window at WINDOW_SIZE", () => {
  let w: boolean[] = [];
  for (let i = 0; i < 15; i++) w = pushResult(w, i % 2 === 0);
  assert.equal(w.length, WINDOW_SIZE);
  // the survivors are the most recent 10 of the 15
  assert.deepEqual(w, Array.from({ length: 15 }, (_, i) => i % 2 === 0).slice(5));
});

test("pushResult: does not mutate its input", () => {
  const original: boolean[] = [true];
  const next = pushResult(original, false);
  assert.deepEqual(original, [true]);
  assert.deepEqual(next, [true, false]);
});

test("emptyWindows: one empty window per drill kind, and nothing else", () => {
  const w = emptyWindows();
  assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
  for (const k of DRILL_KINDS) assert.deepEqual(w[k], []);
});

test("levelFromHistory: an empty window restores level 1", () => {
  assert.equal(levelFromHistory([]), 1);
});

test("levelFromHistory: ten correct answers restore level 3 (the regression this fixes)", () => {
  // A single nextLevel() call against the full window can only move one step
  // from the default (1 -> 2). Replaying over growing prefixes reproduces the
  // climb: 1->2 at 6 correct, 2->3 at ~ the point accuracy holds at >=0.80.
  assert.equal(levelFromHistory(rep(10, true)), 3);
});

test("levelFromHistory: ten wrong answers restore level 1", () => {
  assert.equal(levelFromHistory(rep(10, false)), 1);
});

test("levelFromHistory: fewer than the 6-sample minimum restores 1 regardless of content", () => {
  assert.equal(levelFromHistory(rep(5, true)), 1);
  assert.equal(levelFromHistory(rep(3, false)), 1);
});

test("levelFromHistory: climbs before it slips restores a level >= 2", () => {
  const window = [...rep(8, true), ...rep(2, false)];
  assert.ok(levelFromHistory(window) >= 2, `expected >= 2, got ${levelFromHistory(window)}`);
});

test("levelFromHistory: never returns a value outside 1..3", () => {
  const rng = mulberry32(12345);
  for (let trial = 0; trial < 300; trial++) {
    const len = Math.floor(rng() * 15);
    const window = Array.from({ length: len }, () => rng() < 0.5);
    const level = levelFromHistory(window);
    assert.ok(level >= 1 && level <= 3, `level ${level} out of bounds for window ${JSON.stringify(window)}`);
  }
});

test("mergeSeededWindows: takes the seeded window for kinds not answered this session", () => {
  const seeded = emptyWindows();
  seeded.outs = rep(10, true);
  seeded.potodds = rep(8, true);
  const local = emptyWindows();
  const merged = mergeSeededWindows(seeded, local, []);
  assert.deepEqual(merged.outs, rep(10, true));
  assert.deepEqual(merged.potodds, rep(8, true));
});

test("mergeSeededWindows: keeps the local window for a kind already answered", () => {
  // The bug this exists for: a blanket overwrite rolled the answer back to the
  // server snapshot, invisibly, because Score and XP still reflected it.
  const seeded = emptyWindows();
  seeded.outs = rep(10, true);
  seeded.potodds = rep(10, true);
  const local = emptyWindows();
  local.outs = [false];
  const merged = mergeSeededWindows(seeded, local, ["outs"]);
  assert.deepEqual(merged.outs, [false], "the answered kind must not be overwritten");
  assert.deepEqual(merged.potodds, rep(10, true), "unanswered kinds must still be seeded");
});

test("mergeSeededWindows: one early answer does not discard the other eight kinds", () => {
  const seeded = emptyWindows();
  for (const kind of DRILL_KINDS) seeded[kind] = rep(10, true);
  const local = emptyWindows();
  local.ev = [false];
  const merged = mergeSeededWindows(seeded, local, ["ev"]);
  const seededStill = DRILL_KINDS.filter((k) => merged[k].length === 10);
  assert.equal(seededStill.length, DRILL_KINDS.length - 1);
  assert.deepEqual(merged.ev, [false]);
});

test("mergeSeededWindows: covers every drill kind and mutates neither input", () => {
  const seeded = emptyWindows();
  const local = emptyWindows();
  local.bluff = [true];
  const merged = mergeSeededWindows(seeded, local, ["bluff"]);
  assert.deepEqual(Object.keys(merged).sort(), [...DRILL_KINDS].sort());
  assert.deepEqual(seeded.bluff, [], "seeded must not be mutated");
  assert.deepEqual(local.bluff, [true], "local must not be mutated");
});

test("seededLevels: restores each kind's level from its own window", () => {
  const seeded = emptyWindows();
  seeded.outs = rep(10, true);
  seeded.potodds = rep(10, false);
  const levels = seededLevels(seeded, {}, []);
  assert.equal(levels.outs, 3, "ten correct answers restore to level 3");
  assert.equal(levels.potodds, 1);
  assert.equal(levels.bluff, 1, "an empty window starts at level 1");
});

test("seededLevels: a kind answered this session keeps its session level", () => {
  const seeded = emptyWindows();
  seeded.outs = rep(10, true);
  seeded.ev = rep(10, true);
  const levels = seededLevels(seeded, { ev: 2 }, ["ev"]);
  assert.equal(levels.ev, 2, "the session's own level wins for an answered kind");
  assert.equal(levels.outs, 3, "other kinds still restore from the snapshot");
});

/**
 * The regression this function exists for. The seeding effect re-deals the
 * hand on screen using these levels and reads them synchronously, so a
 * partially-built object silently deals a level-1 hand. Before the fix the
 * levels were assembled inside a `setLevels` updater that React had not yet
 * run, so the re-deal saw `{}` — every page load opened at level 1 and only
 * corrected itself on the first tab switch.
 */
test("seededLevels: returns a level for every kind, ready to deal from", () => {
  const seeded = emptyWindows();
  seeded.outs = rep(10, true);
  const levels = seededLevels(seeded, {}, []);
  assert.deepEqual(Object.keys(levels).sort(), [...DRILL_KINDS].sort());
  for (const kind of DRILL_KINDS) {
    assert.ok(levels[kind]! >= 1 && levels[kind]! <= 3, `${kind} has a usable level`);
  }
});

/* ---------- M8.5C: "Not sure" must not move difficulty ---------- */

test("pushOutcome: a correct or acceptable answer is recorded as a hit", () => {
  assert.deepEqual(pushOutcome([], "correct"), [true]);
  assert.deepEqual(pushOutcome([], "acceptable"), [true]);
});

test("pushOutcome: a wrong answer is recorded as a miss", () => {
  assert.deepEqual(pushOutcome([], "wrong"), [false]);
});

test("pushOutcome: an unsure answer is not recorded at all", () => {
  assert.deepEqual(pushOutcome([], "unsure"), []);
  assert.deepEqual(pushOutcome([true, false], "unsure"), [true, false]);
});

test("pushOutcome: unsure answers can never demote a drill", () => {
  // Ten confident misses in a row would demote; ten shrugs must not.
  let window: boolean[] = [];
  for (let i = 0; i < 10; i++) window = pushOutcome(window, "unsure");
  assert.equal(window.length, 0);
  assert.equal(nextLevel(window, 3), 3);
});

test("pushOutcome: unsure answers cannot be farmed to reach easier questions", () => {
  // A level-3 player at exactly the demotion boundary stays there however many
  // times they say "Not sure" — the window they are judged on does not change.
  const atBoundary = [...rep(5, true), ...rep(5, false)];
  let window = atBoundary;
  const before = nextLevel(window, 3);
  for (let i = 0; i < 20; i++) window = pushOutcome(window, "unsure");
  assert.deepEqual(window, atBoundary);
  assert.equal(nextLevel(window, 3), before);
});

test("pushOutcome: unsure answers also cannot promote", () => {
  let window = rep(9, true);
  for (let i = 0; i < 5; i++) window = pushOutcome(window, "unsure");
  assert.equal(window.length, 9);
});

/* ---------- M8.5B: the placement floor ---------- */

test("seededLevels: placement raises a drill with no history off level 1", () => {
  const levels = seededLevels(emptyWindows(), {}, [], { outs: 2 });
  assert.equal(levels.outs, 2);
  assert.equal(levels.rule24, 1, "a kind placement did not cover stays at 1");
});

test("seededLevels: with no placement, nothing changes", () => {
  assert.deepEqual(
    seededLevels(emptyWindows(), {}, []),
    seededLevels(emptyWindows(), {}, [], {}),
  );
});

test("seededLevels: placement is a floor and never pulls a real level down", () => {
  const windows = emptyWindows();
  windows.outs = rep(WINDOW_SIZE, true); // climbed to level 3 for real
  assert.equal(levelFromHistory(windows.outs), 3);
  assert.equal(seededLevels(windows, {}, [], { outs: 2 }).outs, 3);
});

test("seededLevels: once there is real history, the floor stops applying", () => {
  // Six answers is MIN_SAMPLE — enough for the window to move the level on its
  // own, at which point those answers are better evidence than one placement
  // question. A player who placed at 2 and then missed six in a row must be
  // allowed back down to 1.
  const windows = emptyWindows();
  windows.outs = rep(MIN_SAMPLE, false);
  assert.equal(seededLevels(windows, {}, [], { outs: 2 }).outs, 1);
});

test("seededLevels: the floor still applies while history is below MIN_SAMPLE", () => {
  const windows = emptyWindows();
  windows.outs = rep(MIN_SAMPLE - 1, false);
  assert.equal(seededLevels(windows, {}, [], { outs: 2 }).outs, 2);
});

test("seededLevels: a kind answered this session keeps its session level", () => {
  const levels = seededLevels(emptyWindows(), { outs: 3 }, ["outs"], { outs: 2 });
  assert.equal(levels.outs, 3);
});

/* ------------------------------------------------------------------ *
 * The dashboard and the drill must agree (found on production)
 * ------------------------------------------------------------------ */

/**
 * A freshly-placed player finished placement, was told "the drills you
 * answered correctly start one level up", and then saw every dashboard card
 * reading LVL 1 while the drills themselves opened at level 2.
 *
 * The cause was two derivations of one number: the drill went through
 * `seededLevels` (floor applied), the dashboard through `levelFromHistory`
 * alone (floor ignored). Both now go through `levelWithPlacementFloor`, and
 * these tests pin the rule so a third caller cannot reintroduce the split.
 */
test("placement floors a drill with no history", () => {
  assert.equal(levelWithPlacementFloor([], 2), 2);
  assert.equal(levelWithPlacementFloor([], 3), 3);
  assert.equal(levelWithPlacementFloor([], undefined), 1, "no placement means level 1");
});

test("placement is a floor, never a ceiling", () => {
  // A player whose short history already says 2 is not held at a floor of 1.
  const strong = [true, true, true, true];
  assert.ok(levelWithPlacementFloor(strong, 1) >= levelFromHistory(strong));
});

/**
 * The rule that keeps placement from outliving its usefulness: once the
 * rolling window is a real sample, the answers are better evidence than one
 * placement question — including when they demoted the player.
 */
test("a full history overrides the placement floor in both directions", () => {
  const wrong = Array.from({ length: WINDOW_SIZE }, () => false);
  assert.equal(
    levelWithPlacementFloor(wrong, 3),
    levelFromHistory(wrong),
    "a demoted player must not be propped back up by an old placement"
  );
  const right = Array.from({ length: WINDOW_SIZE }, () => true);
  assert.equal(levelWithPlacementFloor(right, 1), levelFromHistory(right));
});

test("seededLevels and levelWithPlacementFloor cannot disagree", () => {
  // The invariant the production bug violated: whatever path a caller takes,
  // one kind with one history and one floor yields one level.
  const floors: Levels = { outs: 2, potodds: 3 };
  const windows = emptyWindows();
  windows.outs = [true, false];
  windows.potodds = [];
  const viaSeeded = seededLevels(windows, {}, [], floors);
  for (const kind of DRILL_KINDS) {
    assert.equal(
      viaSeeded[kind],
      levelWithPlacementFloor(windows[kind], floors[kind]),
      `${kind}: the two paths disagree`
    );
  }
});

/* The Mixed card had the same bug as the per-kind cards. */

test("mixedLevelFrom: a freshly-placed player is not shown level 1", () => {
  // Zero attempts everywhere, but placement floored eight kinds to 2 — which
  // is exactly what the mixed drill will deal.
  const kinds = [
    ...Array.from({ length: 8 }, () => ({ attempts: 0, level: 2 as DrillLevel })),
    { attempts: 0, level: 1 as DrillLevel },
  ];
  assert.equal(mixedLevelFrom(kinds), 2);
});

test("mixedLevelFrom: a brand-new player with no evidence is level 1", () => {
  const kinds = Array.from({ length: 9 }, () => ({ attempts: 0, level: 1 as DrillLevel }));
  assert.equal(mixedLevelFrom(kinds), 1);
  assert.equal(mixedLevelFrom([]), 1);
});

/**
 * The reason the original `attempts > 0` filter existed, and which the fix
 * must not break: someone who only ever drills a few kinds should not have
 * Mixed dragged down by the ones they have never opened.
 */
test("mixedLevelFrom: untouched kinds do not drag an experienced player down", () => {
  const kinds = [
    { attempts: 40, level: 3 as DrillLevel },
    { attempts: 30, level: 3 as DrillLevel },
    ...Array.from({ length: 7 }, () => ({ attempts: 0, level: 1 as DrillLevel })),
  ];
  assert.equal(mixedLevelFrom(kinds), 3);
});
