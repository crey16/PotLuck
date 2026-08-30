import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ALL_COMBOS } from "./evtable";
import {
  BB_CALL_THRESHOLD,
  FLOOR,
  OPEN,
  assertPayoffInvariant,
  bestResponse,
  btnOpenEv,
  combosOfClass,
  fictitiousPlay,
  formatRangeString,
  gridHands,
  impliedFictitiousPlayCount,
  parseRangeString,
  serialiseRangeFile,
} from "./rangeUpdate";

const REPO = new URL("../..", import.meta.url).pathname;

test("the grid is the 169 classes, in the solver's write order", () => {
  const hands = gridHands();
  assert.equal(hands.length, 169);
  assert.equal(hands[0], "AA");
  assert.equal(hands.at(-1), "22");
  assert.equal(new Set(hands).size, 169);
  assert.equal(hands.reduce((s, h) => s + combosOfClass(h), 0), 1326);
});

test("a range string round-trips through parse and format", () => {
  const freq = new Map(gridHands().map((h, i) => [h, i === 0 ? 1 : (i % 5) / 4]));
  const round = parseRangeString(formatRangeString(freq));
  for (const h of gridHands()) {
    assert.ok(Math.abs((round.get(h) ?? 0) - freq.get(h)!) < 5e-4, h);
  }
});

test("a frequency at or above 0.999 is written as a bare hand", () => {
  const str = formatRangeString(new Map([["AA", 0.9995], ["KK", 0.998]]));
  assert.ok(str.startsWith("AA,"));
  assert.ok(str.includes("KK:0.998"));
});

test("BB calls exactly the combos whose postflop EV beats folding", () => {
  // Folding costs the 10 chips already posted; calling costs 25 more and wins
  // back the hand's share of the pot. So the threshold is 15 chips, and it is
  // strict — a hand that breaks even exactly is not a call.
  const oop = new Map([
    ["AsAh", BB_CALL_THRESHOLD + 1],
    ["AsAd", BB_CALL_THRESHOLD],
    ["7c2d", BB_CALL_THRESHOLD - 1],
  ]);
  const br = bestResponse(oop, new Map());
  assert.deepEqual([...br.bbCalls], ["AsAh"]);
  assert.equal(br.btnOpens.size, 0, "BTN has no EVs, so it opens nothing");
});

test("BTN's open EV mixes the fold-out win with the postflop EV, using card removal", () => {
  const bbCalls = new Set(["7c2d"]);
  const ip = new Map([["AsAh", 100]]);
  // 7c2d shares no card with AsAh, so it is one of the 1225 unblocked combos.
  const pCall = 1 / 1225;
  const expected = (1 - pCall) * 15 + pCall * (100 - OPEN);
  assert.ok(Math.abs(btnOpenEv("AsAh", ip, bbCalls)! - expected) < 1e-9);
  // A hand that blocks the only caller faces no call at all.
  assert.equal(btnOpenEv("7c2h", new Map([["7c2h", 100]]), bbCalls), 15);
  assert.equal(btnOpenEv("KsKh", ip, bbCalls), null, "no EV means no open EV");
});

test("BTN opens whenever that beats folding, which is worth zero", () => {
  // Nobody calls, so every hand with an EV wins the 15 dead chips outright.
  const br = bestResponse(new Map(), new Map([["AsAh", 0], ["7c2d", 0]]));
  assert.equal(br.btnOpens.size, 2);

  // Now the WHOLE deck calls and BTN's postflop share is nothing, so opening
  // is -25 chips and BTN folds. Anything short of that keeps opening
  // profitable: three callers out of 1,326 combos leave the fold-out win
  // almost intact, which is why the solved BTN range is so wide.
  const everything = new Map(ALL_COMBOS.map((c) => [c, 1000] as const));
  assert.equal(bestResponse(everything, new Map([["KsKh", 0]])).btnOpens.size, 0);
  const three = new Map(
    ["AsAh", "7c2d", "8h8d"].map((c) => [c, 1000] as const),
  );
  assert.equal(bestResponse(three, new Map([["KsKh", 0]])).btnOpens.size, 1);
});

test("the payoff invariant catches a pot that is not two opens plus the dead blind", () => {
  assertPayoffInvariant(55);
  assert.throws(() => assertPayoffInvariant(50), /postflop terminal/);
});

test("fictitious play averages the best response into the running range", () => {
  const br = new Map([["AA", 1], ["72o", 0]]);
  const prev = new Map([["AA", 0.5], ["72o", 0.5]]);
  const out = fictitiousPlay(br, prev, 3);
  assert.equal(out.get("AA"), (0.5 * 3 + 1) / 4);
  // (0.5*3 + 0)/4 = 0.375, above the floor, so the floor does not bind.
  assert.equal(out.get("72o"), 0.375);
});

test("without a previous range the best response is taken raw", () => {
  const out = fictitiousPlay(new Map([["AA", 1]]), undefined, 3);
  assert.equal(out.get("AA"), 1);
});

test("the exploration floor keeps every hand in the solve", () => {
  const out = fictitiousPlay(new Map(), undefined, 1);
  assert.equal(out.size, 169);
  for (const h of gridHands()) assert.equal(out.get(h), FLOOR);
});

test("a hand missing from the previous range is treated as a fresh best response", () => {
  // Not as a zero: the previous file only ever omits a hand it never wrote.
  const out = fictitiousPlay(new Map([["AA", 1]]), new Map([["KK", 0.5]]), 3);
  assert.equal(out.get("AA"), 1);
});

test("the fictitious-play count is readable back out of a range file", () => {
  // A DIFFERENT best response each step, because averaging a range into
  // itself leaves the denominators where they were and would prove nothing.
  // Each one is a genuine best response's shape: every class a whole number
  // of its combos.
  let seed = 7;
  const nextBr = () =>
    new Map(
      gridHands().map((h) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const k = combosOfClass(h);
        return [h, (seed % (k + 1)) / k] as const;
      }),
    );
  let running = nextBr();
  assert.equal(impliedFictitiousPlayCount(running), 0, "a raw best response averages one");
  for (let n = 1; n <= 3; n++) {
    running = fictitiousPlay(nextBr(), running, n);
    assert.equal(impliedFictitiousPlayCount(running), n);
  }
});

test("the committed iteration files report the counts docs/14 reconstructed", () => {
  // iter2 is a raw best response; iter3 was written with n=2 and iter4 with
  // n=3, continuing the decreasing-weight schedule that converges.
  for (const [file, expected] of [["iter2", 0], ["iter3", 2], ["iter4", 3]] as const) {
    const j = JSON.parse(
      readFileSync(`${REPO}solver/ranges-${file}-srp-btn-bb.json`, "utf8"),
    );
    assert.equal(impliedFictitiousPlayCount(parseRangeString(j.ip)), expected, file);
  }
});

test("a serialised range file is the shape run-ev.sh consumes", () => {
  const text = serialiseRangeFile({ spot: "srp-btn-bb", oop: "AA", ip: "KK", pot: 55, stack: 975 });
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(JSON.parse(text), { spot: "srp-btn-bb", oop: "AA", ip: "KK", pot: 55, stack: 975 });
});

test("the FP gap ignores the floor, and damping cannot shrink it", async () => {
  const { fpGap } = await import("../gen-range-iter");
  const br = new Map([["AA", 1], ["KK", 0], ["72o", 0], ["QQ", 1]]);
  // sigma carries the floor where the BR folds; that difference is not gap.
  const sigma = new Map([["AA", 1], ["KK", FLOOR], ["72o", 0.75], ["QQ", 0.25]]);
  const mean = new Map([["72o", 5], ["QQ", 40]]);
  const se = new Map([["72o", 20], ["QQ", 5]]);
  const gap = fpGap(br, sigma, mean, se, 15);

  assert.deepEqual(gap.rows.map((r) => r.hand).sort(), ["72o", "QQ"], "KK's floor is not gap");
  assert.equal(gap.decisive, 2);
  // 72o's margin (10 chips) is inside its SE (20) — the sample cannot tell
  // 0.75 from 0 there, so it must not block convergence. QQ's can.
  assert.equal(gap.decisiveResolvable, 1);
  assert.equal(gap.rows.find((r) => r.hand === "QQ")!.resolvable, true);

  // THE POINT: damping sigma toward the BR shrinks the STEP, not the gap,
  // until sigma actually reaches the BR. One n=4 step moves QQ 0.25 -> 0.4;
  // the gap survives at 0.6 of the class. A stopping rule on consecutive
  // iterates would see a step of 0.15 and shrinking; the gap statistic still
  // reports the disagreement.
  const damped = fictitiousPlay(br, sigma, 4);
  const after = fpGap(br, damped, mean, se, 15);
  assert.ok(after.rows.find((r) => r.hand === "QQ")!.combos > 0.5 * 6, "gap persists under damping");
});

test("the gap's EV cost prices a disagreement, and an indifferent class costs nothing", async () => {
  const { fpGap } = await import("../gen-range-iter");
  // QQ: sigma plays it 0.25 where the BR plays it fully, and the class sits 25
  // chips the right side of the threshold. Cost = prior * 0.75 * 25 chips.
  const gap = fpGap(
    new Map([["QQ", 1], ["JJ", 1]]),
    new Map([["QQ", 0.25], ["JJ", 0.25]]),
    new Map([["QQ", 40], ["JJ", 15]]),
    new Map([["QQ", 5], ["JJ", 5]]),
    15,
  );
  const prior = 6 / 1326;
  assert.ok(Math.abs(gap.evCost - prior * 0.75 * 25) < 1e-9);

  // JJ disagrees exactly as much, but its EV is AT the threshold — the two
  // actions are worth the same, so the mixture costs nothing. This is why the
  // EV cost is the quantity that can reach zero and the frequency gap is not:
  // fictitious play's average stays mixed at an indifferent class forever.
  assert.equal(gap.rows.find((r) => r.hand === "JJ")!.margin, 0);
  assert.equal(gap.decisive, 2, "both classes disagree decisively on frequency");

  // `scale` converts postflop margin into chips at the decision. BTN's open EV
  // is p*(ev - threshold), so halving p halves the cost of being wrong.
  const scaled = fpGap(
    new Map([["QQ", 1]]),
    new Map([["QQ", 0.25]]),
    new Map([["QQ", 40]]),
    new Map([["QQ", 5]]),
    15,
    0.5,
  );
  assert.ok(Math.abs(scaled.evCost - prior * 0.75 * 25 * 0.5) < 1e-9);

  // An unresolvable class contributes to the total but not to the part the
  // sample can actually see.
  const noisy = fpGap(
    new Map([["QQ", 1]]),
    new Map([["QQ", 0.25]]),
    new Map([["QQ", 40]]),
    new Map([["QQ", 100]]),
    15,
  );
  assert.ok(noisy.evCost > 0);
  assert.equal(noisy.evCostResolvable, 0);
});

/**
 * THE GATE THIS MODULE EXISTS FOR.
 *
 * `ranges-iter4` was produced by the inline arithmetic in `preflop-br.ts` from
 * `ev/iter3` — the solve run WITH `ranges-iter3` — damped with n=3. If this
 * module cannot reproduce that file byte for byte, then any iter5-vs-iter4
 * diff measures this code against that code rather than one flop sample
 * against another, which answers the wrong question while looking like an
 * answer.
 *
 * `solver/ev/` is git-ignored, so the check can only run where the EVs are.
 */
test("re-derives the committed ranges-iter4 from ev/iter3", async (t) => {
  const evDir = `${REPO}solver/ev/iter3`;
  if (!existsSync(evDir)) {
    t.skip(`${evDir} is absent (solver/ev is git-ignored) — cannot verify`);
    return;
  }
  const { loadSource } = await import("../gen-range-iter");
  const source = loadSource({ dir: evDir });
  const prev = JSON.parse(
    readFileSync(`${REPO}solver/ranges-iter3-srp-btn-bb.json`, "utf8"),
  );
  const text = serialiseRangeFile({
    spot: "srp-btn-bb",
    oop: formatRangeString(fictitiousPlay(source.br.bbClass, parseRangeString(prev.oop), 3)),
    ip: formatRangeString(fictitiousPlay(source.br.btnClass, parseRangeString(prev.ip), 3)),
    pot: source.table.pot,
    stack: source.table.stack,
  });
  assert.equal(text, readFileSync(`${REPO}solver/ranges-iter4-srp-btn-bb.json`, "utf8"));
});
