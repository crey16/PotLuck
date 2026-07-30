"use client";

import { useCallback, useEffect, useState } from "react";
import type { DrillQuestion, Explain, OptionValue, ViewBlock } from "@/lib/drill/contract";
import { gradeAnswer, isRight } from "@/lib/drill/grade";
import { Felt, Seat, Divider } from "@/components/ui/Felt";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { Pills } from "@/components/ui/Pills";
import { RangeGrid } from "@/components/ui/RangeGrid";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { FeedbackPanel, WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";

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
                    <Seat label="Villain (shown)">
                      {b.villain.map((c) => <PlayingCard key={c} card={c} />)}
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
            return <Pills key={i} items={b.items} />;
          case "text":
            return (
              <div
                key={i}
                className={b.tone === "warn" ? "note warnl" : "sub"}
                style={b.center ? { textAlign: "center", margin: "6px 0 0" } : undefined}
              >
                {b.text}
              </div>
            );
          case "grid":
            return <RangeGrid key={i} scenarioId={b.scenarioId} highlight={b.highlight} />;
        }
      })}
    </>
  );
}

function ExplainBody({ explain }: { explain: Explain }) {
  return (
    <>
      <WorkTable>
        {explain.rows.map((r) => <WorkRow key={r.label} label={r.label} value={r.value} />)}
      </WorkTable>
      {explain.notes.map((n, i) => (
        <div key={i} className={n.tone === "warn" ? "note warnl" : "note"}>
          {n.title && <b>{n.title} </b>}
          {n.text}
        </div>
      ))}
      {explain.blocks && <Blocks blocks={explain.blocks} />}
    </>
  );
}

export interface DrillPlayerProps {
  question: DrillQuestion;
  /** Fired once per question, with whether it counted as right. */
  onAnswered: (chosen: OptionValue, right: boolean) => void;
  onNext: () => void;
}

/** Renders and drives ANY DrillQuestion. The only drill state machine. */
export function DrillPlayer({ question, onAnswered, onNext }: DrillPlayerProps) {
  const [chosen, setChosen] = useState<OptionValue | null>(null);
  const answered = chosen !== null;

  // No reset effect here on purpose: DrillShell gives this component a `key`
  // per deal, so a new hand remounts it and `chosen` starts null naturally.
  // Resetting via useEffect would be a setState-in-effect cascade.

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

  return (
    <>
      <div className="prompt">{question.prompt}</div>
      {question.sub && <div className="sub">{question.sub}</div>}
      <Blocks blocks={question.body} />

      <div className={`opts ${question.layout === "one" ? "" : question.layout}`.trim()}>
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
        <>
          <FeedbackPanel
            ok={grade !== "wrong"}
            message={
              grade === "correct" ? "Correct." : grade === "acceptable" ? "Also fine." : "Not quite."
            }
          >
            <ExplainBody explain={question.explain(chosen)} />
          </FeedbackPanel>
          <div className="actions">
            <button className="btn" onClick={onNext}>Next hand →</button>
            <span className="hint">or press <b>N</b> / Enter</span>
          </div>
        </>
      )}
    </>
  );
}
