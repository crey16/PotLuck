/**
 * The Reference content — the written cheat-sheet a user reads when a drill's
 * feedback isn't enough. Redesigned to the Industry spec, but every figure is
 * still computed from the same functions the drills use (lib/poker/math.ts)
 * so this page can never disagree with the drills.
 *
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

/** Outs → equity, the spec's eight rows: 4–9 and the two big flagged draws. */
const OUTS_ROWS = [4, 5, 6, 7, 8, 9, 12, 15].map((outs) => ({
  outs,
  trueTwoCard: hitByRiver(outs),
  ruleOf4: ruleOf2And4(outs, 2),
  corrected: ruleOf4Corrected(outs),
  trueOneCard: hitOnRiver(outs),
}));

// Round-trip through the same helpers the drills grade with, so the one-line
// examples in the cards agree with the tables below them.
const HALF_POT_BLUFF_FOLDS = breakEvenFoldRate(100, 50);
const POT_BLUFF_FOLDS = breakEvenFoldRate(100, 100);
const THIRD_POT_BLUFF_FOLDS = breakEvenFoldRate(100, 100 / 3);
const TWOX_POT_BLUFF_FOLDS = breakEvenFoldRate(100, 200);
const POT_MDF = minDefenceFrequency(100, 100);
const POT_CALLER_NEEDS = requiredEquity(100 + 100, 100);
const HALF_POT_CALLER_NEEDS = requiredEquity(100 + 50, 50);

const FORMULAS: { name: string; formula: string; note: string }[] = [
  {
    name: "Pot odds",
    formula: "call ÷ (pot + call)",
    note: `“Pot” is the pot after their bet — what you win. Half pot → ${pct(HALF_POT_CALLER_NEEDS)}. Pot-sized → ${pct(POT_CALLER_NEEDS)}.`,
  },
  {
    name: "Rule of 2 and 4",
    formula: "outs × 4 (two cards) · outs × 2 (one)",
    note: "Above 8 outs subtract a point per extra out. Only use ×4 when you are all-in.",
  },
  {
    name: "EV of a call",
    formula: "equity × pot − (1 − equity) × call",
    note: "Positive means call, however the hand actually runs out.",
  },
  {
    name: "Break-even bluff",
    formula: "bet ÷ (pot + bet)",
    note: `Risk ÷ (risk + reward). ⅓ pot → ${pct(THIRD_POT_BLUFF_FOLDS)}, ½ → ${pct(HALF_POT_BLUFF_FOLDS)}, pot → ${pct(POT_BLUFF_FOLDS)}, 2× → ${pct(TWOX_POT_BLUFF_FOLDS)}.`,
  },
  {
    name: "MDF",
    formula: "pot ÷ (pot + bet)",
    note: `The bigger they bet, the more you are allowed to fold. Pot-sized bet → ${pct(POT_MDF)}.`,
  },
  {
    name: "Implied odds",
    formula: "(call × (1 − eq) − eq × pot) ÷ eq",
    note: "Extra you must win later. Capped by the stack behind; zero when someone is all-in.",
  },
];

const LEAKS: [string, string][] = [
  ["Counting outs that are dead.", "The card completes your draw and makes them a better hand."],
  ["Using ×4 when more betting is coming.", "×4 only holds when both cards are guaranteed."],
  ["Adding your own dead money to the cost of calling.", "Those chips improve your price."],
  ["Counting implied odds that don’t exist.", "No stack behind, or nobody who pays off."],
  ["Ignoring reverse implied odds.", "Non-nut draws hit and still lose the maximum."],
  ["Judging a decision by the result.", "A +EV call is right on the many times it loses."],
  ["Never bluffing.", "If you are never called, you are folding away pots the math says are yours."],
];

export function ReferenceTab() {
  return (
    <>
      <h2 style={{ fontSize: 26, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>
        The five formulas
      </h2>
      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "var(--space-4)", marginBottom: "var(--space-8)",
        }}
      >
        {FORMULAS.map((f) => (
          <div key={f.name} className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label accent" style={{ letterSpacing: ".12em", marginBottom: 5 }}>
              {f.name}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, marginBottom: 6 }}>{f.formula}</div>
            <div style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 68%, transparent)" }}>
              {f.note}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "var(--space-8)", marginBottom: "var(--space-8)", alignItems: "start",
        }}
      >
        <section>
          <h2 style={{ fontSize: 26, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 var(--space-2)" }}>
            Outs → equity
          </h2>
          <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "0 0 var(--space-3)" }}>
            Exact percentages against the rules of thumb. Flagged rows are where ×4 starts lying to you.
          </p>
          <table className="table" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                <th>Outs</th>
                <th className="num">True (2 cards)</th>
                <th className="num">×4 rule</th>
                <th className="num">Corrected</th>
                <th className="num">True (1 card)</th>
              </tr>
            </thead>
            <tbody>
              {OUTS_ROWS.map((r) => (
                <tr key={r.outs}>
                  <td>{r.outs}</td>
                  <td className="num">{Math.round(r.trueTwoCard * 100)}%</td>
                  <td className={r.outs > 8 ? "num flag" : "num"}>
                    {r.ruleOf4}%
                    {r.outs > 8 && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}> ⚑</span>
                    )}
                  </td>
                  <td className="num">{r.corrected}%</td>
                  <td className="num">{Math.round(r.trueOneCard * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 style={{ fontSize: 26, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 var(--space-2)" }}>
            Bet size ↔ the numbers
          </h2>
          <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "0 0 var(--space-3)" }}>
            One row per sizing. Learn the pot-sized column first.
          </p>
          <table className="table" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr>
                <th>Bet</th>
                <th className="num">Caller needs</th>
                <th className="num">Bluff needs folds</th>
                <th className="num">MDF</th>
              </tr>
            </thead>
            <tbody>
              {BET_SIZE_TABLE.map((row) => (
                <tr key={row.fraction}>
                  <td>{row.label}</td>
                  <td className="num">{Math.round(row.callerNeeds * 100)}%</td>
                  <td className="num">{Math.round(row.bluffNeedsFolds * 100)}%</td>
                  <td className="num">{Math.round(row.mdf * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <h2 style={{ fontSize: 26, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 var(--space-4)" }}>
          The seven leaks this trainer targets
        </h2>
        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "var(--space-3) var(--space-8)",
          }}
        >
          {LEAKS.map(([head, tail], i) => (
            <div
              key={head}
              style={{
                display: "flex", gap: "var(--space-3)", padding: "var(--space-2) 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-accent-700)", flex: "none" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 14 }}>
                <b>{head}</b> {tail}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
