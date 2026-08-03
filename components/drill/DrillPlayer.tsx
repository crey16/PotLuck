"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DrillQuestion, Explain, OptionValue, ViewBlock } from "@/lib/drill/contract";
import { gradeAnswer, isRight } from "@/lib/drill/grade";
import { Felt, Seat, Divider } from "@/components/ui/Felt";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { MoneyStrip } from "@/components/ui/MoneyStrip";
import { RangeGrid } from "@/components/ui/RangeGrid";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";

function Blocks({ blocks }: { blocks: ViewBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "felt":
            return (
              <Felt key={i}>
                <Seat label="Your hand">
                  {b.hero.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
                <Divider />
                <Seat label={`Board — ${b.street}`}>
                  {b.board.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
                {b.villain && (
                  <>
                    <Divider />
                    <Seat label="Villain — shown" accent>
                      {b.villain.map((c) => <PlayingCard key={c} card={c} highlight />)}
                    </Seat>
                  </>
                )}
              </Felt>
            );
          case "hand":
            return (
              <Felt key={i}>
                <Seat label={b.label}>
                  {b.cards.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
              </Felt>
            );
          case "money":
            return <MoneyStrip key={i} items={b.items} />;
          case "text":
            return b.tone === "warn" ? (
              <div key={i} className="note warnl" style={{ display: "flex", gap: "var(--space-3)" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.5" style={{ flex: "none", marginTop: 3 }}>
                  <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
                </svg>
                <span>{b.text}</span>
              </div>
            ) : (
              <p
                key={i}
                style={{
                  fontSize: 14,
                  color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
                  margin: "var(--space-3) 0 0",
                  ...(b.center ? { textAlign: "center" as const } : {}),
                }}
              >
                {b.text}
              </p>
            );
          case "grid":
            return (
              <div key={i} style={{ margin: "var(--space-3) 0" }}>
                <RangeGrid scenarioId={b.scenarioId} highlight={b.highlight} />
              </div>
            );
        }
      })}
    </>
  );
}

function ExplainBody({ explain }: { explain: Explain }) {
  return (
    <>
      <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-2)" }}>
        Working
      </div>
      <WorkTable>
        {explain.rows.map((r) => <WorkRow key={r.label} label={r.label} value={r.value} />)}
      </WorkTable>
      {explain.notes.map((n, i) => (
        <div key={i} className={n.tone === "warn" ? "note warnl" : "note"} style={n.tone === "warn" ? { display: "flex", gap: "var(--space-3)" } : undefined}>
          {n.tone === "warn" && (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.5" style={{ flex: "none", marginTop: 3 }}>
              <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
            </svg>
          )}
          <span>
            {n.title && <b>{n.title} </b>}
            {n.text}
          </span>
        </div>
      ))}
      {explain.blocks && <Blocks blocks={explain.blocks} />}
    </>
  );
}

export interface DrillPlayerProps {
  question: DrillQuestion;
  /** The session run AFTER this answer landed — shown in the feedback bar. */
  run: number;
  /** Fired once per question, with whether it counted as right. */
  onAnswered: (chosen: OptionValue, right: boolean) => void;
  onNext: () => void;
}

/** Renders and drives ANY DrillQuestion. The only drill state machine. */
export function DrillPlayer({ question, run, onAnswered, onNext }: DrillPlayerProps) {
  const [chosen, setChosen] = useState<OptionValue | null>(null);
  const answered = chosen !== null;

  // No reset effect here on purpose: DrillShell gives this component a `key`
  // per deal, so a new hand remounts it and `chosen` starts null naturally.

  const handleAnswer = useCallback(
    (value: OptionValue) => {
      if (chosen !== null) return;
      setChosen(value);
      onAnswered(value, isRight(question, value));
    },
    [chosen, question, onAnswered]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never swallow keys while the user is typing in a field.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!answered) {
        const idx = Number(e.key) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < question.options.length) {
          e.preventDefault();
          handleAnswer(question.options[idx].value);
        }
      } else if (e.key.toUpperCase() === "N" || e.key === "Enter") {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answered, question, handleAnswer, onNext]);

  const grade = answered ? gradeAnswer(question, chosen) : null;
  const ok = grade !== null && grade !== "wrong";

  const chosenLabel = answered
    ? question.options.find((o) => o.value === chosen)?.label
    : undefined;
  const correctLabel = question.options.find(
    (o) => gradeAnswer(question, o.value) === "correct"
  )?.label;

  return (
    <>
      <h2 style={{ fontSize: 34, lineHeight: 1.05, margin: "0 0 var(--space-2)", textWrap: "pretty" }}>
        {question.prompt}
      </h2>
      {question.sub && (
        <p
          style={{
            fontSize: 15,
            color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
            margin: "0 0 var(--space-6)",
            maxWidth: "60ch",
          }}
        >
          {question.sub}
        </p>
      )}
      <Blocks blocks={question.body} />

      <div className={`opts opts-${question.kind} ${question.layout === "one" ? "" : question.layout}`.trim()}>
        {question.options.map((o, i) => {
          let state: OptionButtonState = "idle";
          if (answered) {
            const g = gradeAnswer(question, o.value);
            if (g === "correct" || g === "acceptable") state = "correct";
            else if (o.value === chosen) state = "wrong";
            else state = "disabled";
          }
          return (
            <OptionButton
              key={String(o.value)}
              keyHint={String(i + 1)}
              state={state}
              onClick={() => handleAnswer(o.value)}
            >
              {o.label}
              {answered && gradeAnswer(question, o.value) === "acceptable" && " — also fine"}
            </OptionButton>
          );
        })}
      </div>

      {answered && (
        <div className={`fb${ok ? "" : " no"}`}>
          <div className="bar">
            <span className="glyph">
              {ok ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              )}
            </span>
            <span className="word">
              {grade === "correct" ? "Correct" : grade === "acceptable" ? "Also fine" : "Not quite"}
            </span>
            <span className="xp">
              {ok
                ? "+10 XP"
                : chosenLabel && correctLabel
                  ? `You picked ${chosenLabel} · answer ${correctLabel}`
                  : ""}
            </span>
            <span className="run">{ok ? `Run ${run}` : "Run reset"}</span>
          </div>
          <div className="body">
            <ExplainBody explain={question.explain(chosen)} />
            <div className="actions">
              <button
                className="btn btn-primary blueprint btn-caps"
                style={{ fontSize: 15, padding: "11px 20px", letterSpacing: ".05em" }}
                onClick={onNext}
              >
                Next hand
                <span className="keyhint">N</span>
              </button>
              <span className="hint">or Enter</span>
              {!ok && (
                <Link href={`/reference?from=${question.kind}`} className="btn btn-secondary btn-caps">
                  Read the formula
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
