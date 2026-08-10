import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PracticeSetup } from "./PracticeSetup";
import {
  ACTION_FAMILY_LABEL,
  DEFAULT_CONFIG,
  SIX_MAX_POSITIONS,
  STACK_DEPTHS,
  STACK_DEPTH_LABEL,
  SUPPORT,
  TABLE_SIZE_LABEL,
  availableOptions,
  isChoosable,
  validateConfig,
  type ActionFamily,
  type PracticeConfig,
  type TableSize,
} from "@/lib/play/setup";

/**
 * The setup screen must not advertise what the product cannot do.
 *
 * M10A shipped the opposite treatment: every unbuilt option drawn, struck
 * through, with its reason — and its roadmap milestone — printed underneath.
 * That was written for a reader who wanted to know what was coming. To a
 * player it reads as a product that mostly does not work, and `(M8.7D)` in a
 * product string is a leak rather than an explanation.
 *
 * Reversing it creates exactly one new way to be wrong, and it is the one
 * these tests are mostly about: **hiding an option must never make an invalid
 * configuration startable.** The model (`SUPPORT`, `validateConfig`) is
 * unchanged and complete; only the rendering filters. If those two ever come
 * apart, a stale URL or a restored session could start a hand the pack cannot
 * honour, and the player would be told they practised something they did not.
 */

const render = (config: PracticeConfig = DEFAULT_CONFIG) =>
  renderToStaticMarkup(
    h(PracticeSetup, { config, onChange: () => {}, onStart: () => {} })
  );

/* ------------------------------------------------ nothing unbuilt is drawn */

test("no unavailable option label appears on the screen", () => {
  const markup = render();

  const hidden: string[] = [
    ...(Object.keys(TABLE_SIZE_LABEL) as unknown as TableSize[])
      .filter((t) => !SUPPORT.tableSize[t].available)
      .map((t) => TABLE_SIZE_LABEL[t]),
    ...(Object.keys(ACTION_FAMILY_LABEL) as ActionFamily[])
      .filter((f) => !SUPPORT.actionFamily[f].available)
      .map((f) => ACTION_FAMILY_LABEL[f]),
    ...STACK_DEPTHS.filter((d) => !SUPPORT.stackDepth[d].available).map(
      (d) => STACK_DEPTH_LABEL[d]
    ),
  ];
  assert.ok(hidden.length > 0, "nothing is unavailable — this test has stopped testing");

  for (const label of hidden) {
    assert.ok(!markup.includes(label), `"${label}" is unbuilt and must not be offered`);
  }
});

test("no unavailable option's REASON appears on the screen either", () => {
  // The reasons are the model's honesty and are still required — they are what
  // `validateConfig` reports. They are not player-facing marketing for
  // features that do not exist.
  const markup = render();
  const reasons = [
    SUPPORT.tableSize[2].reason,
    SUPPORT.tableSize[9].reason,
    SUPPORT.heroPosition.UTG.reason,
    SUPPORT.actionFamily.three_bet.reason,
    SUPPORT.actionFamily.squeeze.reason,
    SUPPORT.stackDepth[10].reason,
  ].filter((r): r is string => Boolean(r));

  assert.equal(reasons.length, 6);
  for (const reason of reasons) {
    // Compared on a distinctive fragment: the full sentence contains an em
    // dash that HTML-escapes differently across renderers.
    const fragment = reason.slice(0, 24);
    assert.ok(!markup.includes(fragment), `a disabled option's reason is on screen: ${fragment}…`);
  }
});

test("an axis with one surviving option is not drawn as a control", () => {
  const markup = render();
  // With today's pack these three collapse to a single value each. A control
  // offering one choice is a label pretending to be a control; the value is
  // stated in the Solve assumptions panel instead.
  assert.equal(isChoosable([2, 6, 9] as TableSize[], SUPPORT.tableSize), false);
  assert.equal(
    isChoosable(Object.keys(ACTION_FAMILY_LABEL) as ActionFamily[], SUPPORT.actionFamily),
    false
  );
  assert.equal(isChoosable(STACK_DEPTHS, SUPPORT.stackDepth), false);

  for (const legend of ["Table size", "Preflop action", "Effective stack"]) {
    assert.ok(!markup.includes(legend), `"${legend}" should not be drawn with one choice`);
  }
});

test("an axis that IS a real choice is still drawn", () => {
  // The guard against over-hiding. All four stopping points ship, so this
  // control must survive — a change that hid everything would pass every
  // assertion above and fail here.
  const markup = render();
  assert.ok(markup.includes("How far the hand goes"));
  for (const label of ["Preflop only", "Through the flop", "Through the turn", "Full hand"]) {
    assert.ok(markup.includes(label), `${label} is available and must be offered`);
  }
});

test("the unsolved seats are actually disabled, not merely dimmed", () => {
  // The bug this test exists for, found by clicking the rendered page rather
  // than by reading it. `Seat` disabled itself with
  // `disabled={Boolean(unavailableReason)}` — availability expressed through
  // the presence of a string — so the moment the setup screen stopped passing
  // reasons, UTG/HJ/CO/SB became clickable. Every markup assertion above
  // still passed: the seats looked right and behaved wrong.
  const markup = render();
  // One <button disabled> per unsolved seat, and none for the two playable ones.
  const disabledButtons = markup.match(/<button[^>]*\bdisabled\b[^>]*>/g) ?? [];
  const unsolved = SIX_MAX_POSITIONS.filter((p) => !SUPPORT.heroPosition[p].available);
  assert.equal(unsolved.length, 4, "expected UTG, HJ, CO and SB to be unsolved");

  for (const seat of unsolved) {
    // The seat's own button must carry `disabled`. Matched by finding the
    // button whose content includes the position label.
    const pattern = new RegExp(`<button[^>]*disabled[^>]*>(?:(?!</button>)[\\s\\S])*?${seat}`);
    assert.match(markup, pattern, `seat ${seat} has no solve behind it and must not be clickable`);
  }
  assert.ok(disabledButtons.length >= 4, "the unsolved seats should be disabled controls");
});

test("the six seats stay on the table", () => {
  // They are not unbuilt options being advertised — they are the hand:
  // everyone folded round to the button. Drawing two seats would depict a
  // heads-up game and misstate the spot being practised.
  const markup = render();
  for (const seat of SIX_MAX_POSITIONS) {
    assert.ok(markup.includes(seat), `seat ${seat} vanished from the table`);
  }
});

/* --------------------------------------- hiding did not weaken the guard */

test("every hidden option is still refused by the validator", () => {
  // The load-bearing test. Rendering filters; validation does not. A config
  // that arrives by any other route — a stale URL, a restored session, a
  // future caller — must still be refused.
  const cases: PracticeConfig[] = [
    { ...DEFAULT_CONFIG, tableSize: 2 },
    { ...DEFAULT_CONFIG, tableSize: 9 },
    { ...DEFAULT_CONFIG, heroPosition: "UTG" },
    { ...DEFAULT_CONFIG, heroPosition: "SB" },
    { ...DEFAULT_CONFIG, actionFamily: "three_bet" },
    { ...DEFAULT_CONFIG, actionFamily: "squeeze" },
    { ...DEFAULT_CONFIG, stackDepth: 10 },
    { ...DEFAULT_CONFIG, stackDepth: 20 },
  ];
  for (const config of cases) {
    const result = validateConfig(config);
    assert.equal(result.ok, false, `${JSON.stringify(config)} must not be startable`);
    assert.ok(result.problems.length > 0, "a refusal must say why");
  }
});

test("availableOptions and isChoosable read SUPPORT, never a hard-coded list", () => {
  // If these ever diverge from SUPPORT, the screen and the validator are
  // answering two different questions.
  assert.deepEqual(availableOptions([2, 6, 9] as TableSize[], SUPPORT.tableSize), [6]);
  assert.deepEqual(
    availableOptions(SIX_MAX_POSITIONS, SUPPORT.heroPosition).sort(),
    ["BB", "BTN"]
  );
  assert.equal(isChoosable(SIX_MAX_POSITIONS, SUPPORT.heroPosition), true);
  assert.equal(isChoosable([2, 6, 9] as TableSize[], SUPPORT.tableSize), false);
  // Empty and single inputs must not throw or report a choice.
  assert.deepEqual(availableOptions([] as TableSize[], SUPPORT.tableSize), []);
  assert.equal(isChoosable([] as TableSize[], SUPPORT.tableSize), false);
});

/* ------------------------------------------------------- the leak guard */

test("no internal milestone code reaches a user-facing string", () => {
  // The thing that prompted this change: `(M8.7D)`, `(M10E)`, `(M8.7E)` were
  // printed on the setup screen. Comments may name milestones — that is what
  // comments are for — so this reads the QUOTED STRINGS only.
  const root = path.join(import.meta.dirname, "..", "..");
  const files = [
    ["lib", "play", "setup.ts"],
    ["components", "play", "PracticeSetup.tsx"],
  ];
  const milestone = /\bM\d+(\.\d+)?[A-Z]?\b/;

  for (const file of files) {
    const source = readFileSync(path.join(root, ...file), "utf8");
    // Strip comments first, then look inside double-quoted literals.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const [, literal] of code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      // Import specifiers and class names are not prose.
      if (literal.startsWith("@/") || literal.startsWith(".") || literal.length < 12) continue;
      assert.ok(
        !milestone.test(literal),
        `${file.join("/")} ships a milestone code to the player: "${literal}"`
      );
    }
  }
});

test("the screen renders no milestone code at all", () => {
  // The same guard from the other end: whatever the strings say, this is what
  // a player's browser receives.
  assert.doesNotMatch(render(), /\bM\d+(\.\d+)?[A-Z]?\b/);
});

/* ------------------------------------------------------------ still works */

test("the default configuration renders and is startable", () => {
  const markup = render();
  assert.ok(markup.includes("Choose the hand you want to train."));
  assert.ok(markup.includes("Start training"));
  assert.equal(validateConfig(DEFAULT_CONFIG).ok, true);
  // And the assumptions panel still states what the hidden axes settled on,
  // so the information did not disappear with the controls.
  assert.ok(markup.includes("6-max cash, chip EV"));
  assert.ok(markup.includes("100bb effective"));
});
