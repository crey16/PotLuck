/**
 * The Reference tab — the written cheat-sheet a user reads when a drill's
 * feedback isn't enough. Ported from the `REF` template literal in
 * reference/poker-math-trainer.html (from line 1318).
 *
 * Every figure here is computed from the same functions the drills use
 * (lib/poker/math.ts) so this table can never disagree with the drills.
 * No state, no browser APIs — deliberately not a client component.
 */
import {
  BET_SIZE_TABLE,
  breakEvenFoldRate,
  hitByRiver,
  hitOnRiver,
  minDefenceFrequency,
  requiredEquity,
  ruleOf2And4,
  ruleOf4Corrected,
} from "@/lib/poker/math";
import { pct } from "@/lib/drill/opts";

/** Outs → equity, 1 through 15, exact against the rule-of-thumb estimates. */
const OUTS_ROWS = Array.from({ length: 15 }, (_, i) => i + 1).map((outs) => ({
  outs,
  trueTwoCard: hitByRiver(outs),
  ruleOf4: ruleOf2And4(outs, 2),
  corrected: ruleOf4Corrected(outs),
  trueOneCard: hitOnRiver(outs),
  ruleOf2: ruleOf2And4(outs, 1),
}));

/** Draws worth knowing cold, with their outs (a fixed, well-known list — not derived). */
const KNOWN_DRAWS: Array<[label: string, outs: number]> = [
  ["Flush draw + open-ender", 15],
  ["Flush draw + gutshot", 12],
  ["Flush draw + two overcards", 15],
  ["Flush draw", 9],
  ["Open-ended straight draw", 8],
  ["Two overcards", 6],
  ["Bottom pair → trips or two pair", 5],
  ["Gutshot", 4],
  ["Two pair → full house", 4],
  ["Pocket pair → set", 2],
  ["One overcard", 3],
];

// Round-trip through requiredEquity(pot, call) exactly as BET_SIZE_TABLE does,
// so the one-line formula examples in prose agree with the table below it.
const HALF_POT_BLUFF_FOLDS = breakEvenFoldRate(100, 50);
const POT_BLUFF_FOLDS = breakEvenFoldRate(100, 100);
const POT_MDF = minDefenceFrequency(100, 100);
const POT_CALLER_NEEDS = requiredEquity(100 + 100, 100);
const HALF_POT_CALLER_NEEDS = requiredEquity(100 + 50, 50);

export function ReferenceTab() {
  return (
    <div className="ref">
      <h3>
        The five formulas<span className="tag">memorise these</span>
      </h3>
      <div className="formula">
        <b>Pot odds</b> — equity you need to call = <b>call ÷ (pot + call)</b>
        <br />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          &quot;pot&quot; = the pot after villain&rsquo;s bet, i.e. what you win. Half-pot bet
          → {pct(HALF_POT_CALLER_NEEDS)}. Pot-sized bet → {pct(POT_CALLER_NEEDS)}.
        </span>
      </div>
      <div className="formula">
        <b>Rule of 2 and 4</b> — equity ≈ outs × 4 with two cards to come, outs × 2 with one.
        <br />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Above 8 outs, subtract one point per extra out. Only use ×4 when you&rsquo;re all-in.
        </span>
      </div>
      <div className="formula">
        <b>EV of a call</b> = equity × pot − (1 − equity) × call
      </div>
      <div className="formula">
        <b>Break-even bluff</b> — folds needed = <b>bet ÷ (pot + bet)</b>
        <br />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Risk ÷ (risk + reward). ⅓ pot → {pct(breakEvenFoldRate(100, 100 / 3))}, ½ pot →{" "}
          {pct(HALF_POT_BLUFF_FOLDS)}, ¾ pot → {pct(breakEvenFoldRate(100, 75))}, pot →{" "}
          {pct(POT_BLUFF_FOLDS)}, 2× pot → {pct(breakEvenFoldRate(100, 200))}.
        </span>
      </div>
      <div className="formula">
        <b>MDF</b> — how much you must defend = <b>pot ÷ (pot + bet)</b>
        <br />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          The bigger they bet, the more you&rsquo;re allowed to fold. Pot-sized bet → MDF{" "}
          {pct(POT_MDF)}.
        </span>
      </div>
      <div className="formula">
        <b>Implied odds</b> — extra you must win later ={" "}
        <b>(call × (1 − eq) − eq × pot) ÷ eq</b>
        <br />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Capped by the stack behind. Zero when someone is all-in.
        </span>
      </div>

      <h3>Outs → equity</h3>
      <p>
        Exact percentages against the rule-of-thumb estimates. Highlighted cells are where the
        ×4 rule starts lying to you.
      </p>
      <table className="t">
        <thead>
          <tr>
            <th>Outs</th>
            <th>True (2 cards)</th>
            <th>×4 rule</th>
            <th>Corrected</th>
            <th>True (1 card)</th>
            <th>×2 rule</th>
          </tr>
        </thead>
        <tbody>
          {OUTS_ROWS.map((r) => (
            <tr key={r.outs}>
              <td>{r.outs}</td>
              <td>{Math.round(r.trueTwoCard * 100)}%</td>
              <td className={r.outs > 8 ? "hi" : undefined}>{r.ruleOf4}%</td>
              <td>{r.corrected}%</td>
              <td>{Math.round(r.trueOneCard * 100)}%</td>
              <td>{r.ruleOf2}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Outs you should know cold</h3>
      <table className="t">
        <thead>
          <tr>
            <th>Draw</th>
            <th>Outs</th>
            <th>Flop → river</th>
            <th>One card</th>
          </tr>
        </thead>
        <tbody>
          {KNOWN_DRAWS.map(([label, outs]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{outs}</td>
              <td>{Math.round(hitByRiver(outs) * 100)}%</td>
              <td>{Math.round(hitOnRiver(outs) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Bet size ↔ the numbers it implies</h3>
      <table className="t">
        <thead>
          <tr>
            <th>Bet</th>
            <th>Caller needs</th>
            <th>Bluff needs folds</th>
            <th>MDF</th>
          </tr>
        </thead>
        <tbody>
          {BET_SIZE_TABLE.map((row) => (
            <tr key={row.fraction}>
              <td>{row.label}</td>
              <td>{Math.round(row.callerNeeds * 100)}%</td>
              <td>{Math.round(row.bluffNeedsFolds * 100)}%</td>
              <td>{Math.round(row.mdf * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>The seven leaks this trainer targets</h3>
      <p>
        1. <b>Counting outs that are dead</b> — the card completes your draw but makes villain a
        better hand.
        <br />
        2. <b>Using ×4 when more betting is coming</b> — ×4 only holds if you&rsquo;re all-in and
        guaranteed both cards.
        <br />
        3. <b>Adding your own dead money to the cost of calling</b> — chips in the pot are not
        yours; they improve your price.
        <br />
        4. <b>Counting implied odds that don&rsquo;t exist</b> — no stack behind, or an opponent
        who never pays off.
        <br />
        5. <b>Ignoring reverse implied odds</b> — non-nut draws hit and still lose the maximum.
        <br />
        6. <b>Judging a decision by the result</b> — a +EV call is right on the many occasions it
        loses.
        <br />
        7. <b>Never bluffing</b> — if you&rsquo;re never called, you&rsquo;re folding away pots
        the math says are yours.
      </p>

      <h3>Dead outs — the one to internalise</h3>
      <p>
        An out is only an out if it wins. A card that completes your flush but pairs the board
        can hand villain a full house; a card that makes your straight can make them a bigger
        one. Every drill here counts outs with a real hand evaluator, so dead outs are stripped
        automatically and listed back to you in the feedback. Count your outs, then subtract the
        ones that help them more than they help you.
      </p>

      <h3>Using the trainer</h3>
      <p>
        The <b>Opponent</b> toggle sets how hard the counting itself is.
      </p>
      <p>
        <b>Unknown</b> (the default) — you see only your two cards and the board, and an out is
        any card that completes your draw. Boards are kept clean: never paired, never four to a
        flush, and a named draw always has the number of outs it is supposed to have. This is the
        mode for building the count.
      </p>
      <p>
        <b>Face-up</b> — villain&rsquo;s hand is shown, and an out is only a card that actually
        beats them. Dead outs get stripped and listed back with the reason, and awkward boards
        come back in. Switch to this once counting your own draw is automatic.
      </p>
      <p>
        The <b>Preflop drill</b> uses standard 6-max preflop ranges. Those are solver-shaped
        reference ranges, not live solver output — treat them as a study aid, not a source of
        truth.
      </p>

      <h3>Shortcuts</h3>
      <p>
        Press the number beside an answer to pick it — <b>1</b> and <b>2</b> where a drill offers
        two choices, <b>1</b>–<b>4</b> where it offers four. Then <b>N</b> or <b>Enter</b> for the
        next hand.
      </p>
    </div>
  );
}
