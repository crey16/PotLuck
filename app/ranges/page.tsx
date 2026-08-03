"use client";

import { useState } from "react";
import { RangeGrid } from "@/components/ui/RangeGrid";
import { cellFrequency, getScenario, SCENARIOS } from "@/lib/poker/ranges";

const DEALT_HAND = "T9s";

export default function RangesPage() {
  const [scenarioId, setScenarioId] = useState("bb-btn");
  const scenario = getScenario(scenarioId) ?? SCENARIOS[0];
  const dealt = cellFrequency(scenario, DEALT_HAND);
  const actionLabel = scenario.actions.find(([key]) => key === "r")?.[1] ?? "Raise";
  const activeActions: Array<readonly [string, number]> = [
    [actionLabel, dealt.r],
    ...(scenario.c ? [["Call", dealt.c] as const] : []),
    ["Fold", dealt.f],
  ];
  const nonZeroActions = activeActions.filter(([, frequency]) => frequency > 0.001);

  return (
    <main className="page">
      <div
        style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: "var(--space-6)", flexWrap: "wrap", marginBottom: "var(--space-6)",
        }}
      >
        <div>
          <div className="mono-label accent" style={{ letterSpacing: ".14em", marginBottom: 6 }}>
            169 combos · 6-max · 100bb · 2.5bb opens
          </div>
          <h1 style={{ fontSize: 44, lineHeight: 1, margin: 0 }}>Preflop ranges</h1>
        </div>
        <div
          style={{
            border: "1px solid var(--warn)", borderLeftWidth: 3,
            padding: "var(--space-3) var(--space-4)", maxWidth: 430,
            display: "flex", gap: "var(--space-3)", alignItems: "flex-start",
            background: "var(--warn-fill)",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.5" style={{ flex: "none", marginTop: 3 }}>
            <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
          </svg>
          <span style={{ fontSize: 13 }}>
            <b className="note-title">Reference ranges, not solver output. </b>
            Standard ranges in the shape solvers produce. Real solutions move with rake, stack
            depth, open size and table dynamics.
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex", gap: "var(--space-1)", flexWrap: "wrap",
          marginBottom: "var(--space-6)",
          borderBottom: "1px solid var(--color-divider)", paddingBottom: "var(--space-4)",
        }}
      >
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={`scen${s.id === scenarioId ? " on" : ""}`}
            onClick={() => setScenarioId(s.id)}
          >
            {s.name.includes(" vs ") ? s.name.replace(/ open$/, "") : s.name}
          </button>
        ))}
      </div>

      <div className="ranges-layout">
        <RangeGrid scenarioId={scenarioId} highlight={DEALT_HAND} />
        <aside className="ranges-aside">
          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: 6 }}>
              Dealt hand
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <div className="range-dealt-cards" aria-label="Ten and nine of spades">
                <span><b>10</b><i>♠</i></span>
                <span><b>9</b><i>♠</i></span>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 25, lineHeight: 1 }}>
                  {DEALT_HAND}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
                  4 combos
                </div>
              </div>
            </div>
            <div className="range-action-list">
              {activeActions.map(([label, frequency]) => (
                <div key={label}>
                  <span>{label}</span>
                  <span>{Math.round(frequency * 100)}%</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "var(--space-3)", fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
              {nonZeroActions.length > 1
                ? "A mix. Either action is accepted; keep the split roughly honest across sessions."
                : `${nonZeroActions[0]?.[0] ?? "Fold"} this hand in this spot.`}
            </div>
          </div>
          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: 6 }}>
              On a phone
            </div>
            <p style={{ fontSize: 13, margin: 0, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>
              The grid stays one square: 13 columns of the viewport width, labels drop to 8px,
              and the split fills stay readable because they are value steps of one hue, not two
              hues. Pinch-zoom is never required.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
