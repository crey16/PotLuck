"use client";

import { useCallback, useEffect, useState } from "react";
import { dealDrawSpot, describeOuts, type Spot } from "@/lib/poker/engine";
import { buildOutsQuestion, type OutsQuestion } from "@/lib/drill/outsQuestion";
import type { OutsDrillResult } from "@/lib/drill/recordAttempt";
import { Felt, Seat, Divider } from "@/components/ui/Felt";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { StatTile } from "@/components/ui/StatTile";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { FeedbackPanel, WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";

export type { OutsDrillResult };

export interface OutsDrillProps {
  /** Profile level for the Level tile — falls back to 1 while unauthenticated. */
  level?: number;
  /** Fired once per answer. Optional — Task 6 wires this to the API. */
  onResult?: (result: OutsDrillResult) => void;
}

interface Hand {
  spot: Spot;
  question: OutsQuestion;
}

function dealHand(): Hand {
  const street = Math.random() < 0.4 ? "turn" : "flop";
  const spot = dealDrawSpot({ street, level: 2 });
  const question = buildOutsQuestion(spot, Math.random);
  return { spot, question };
}

type Phase = "question" | "answered";

/** Client-side state machine for the "Count your outs" drill (Task 4). */
export function OutsDrill({ level = 1, onResult }: OutsDrillProps) {
  const [hand, setHand] = useState<Hand>(() => dealHand());
  const [phase, setPhase] = useState<Phase>("question");
  const [chosen, setChosen] = useState<number | null>(null);

  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  const { spot, question } = hand;

  const handleAnswer = useCallback(
    (value: number) => {
      if (phase === "answered") return;
      const correct = value === question.answer;
      setChosen(value);
      setPhase("answered");
      setTotalCount((t) => t + 1);
      if (correct) {
        setScore((s) => s + 10);
        setCorrectCount((c) => c + 1);
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        setBestStreak((b) => Math.max(b, nextStreak));
      } else {
        setStreak(0);
      }
      onResult?.({ spot, answer: value, correct });
    },
    [phase, question, spot, streak, onResult]
  );

  const handleNext = useCallback(() => {
    setHand(dealHand());
    setPhase("question");
    setChosen(null);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (phase === "question") {
        const idx = Number(e.key) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < question.options.length) {
          e.preventDefault();
          handleAnswer(question.options[idx]);
        }
      } else if (e.key.toUpperCase() === "N" || e.key === "Enter") {
        e.preventDefault();
        handleNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, question, handleAnswer, handleNext]);

  const accuracy = totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
  const chip = question.street === "flop" ? "Flop" : "Turn";
  const chanceLabel =
    question.street === "flop" ? "Chance of hitting by the river" : "Chance of hitting on the river";

  return (
    <>
      <div className="stats">
        <StatTile label="Score" value={score} />
        <StatTile label="Accuracy" value={`${accuracy}%`} meterPercent={accuracy} />
        <StatTile label="Streak" value={streak} sub={`best ${bestStreak}`} />
        {/* The pip display caps visually at 3 while XP level is unbounded. */}
        <StatTile label="Level" value={level} pips={Math.min(level, 3)} />
      </div>

      <div className="panel">
        <div className="qhead">
          <span className="kicker">Counting outs</span>
          <span className="chip">{chip}</span>
        </div>
        <div className="prompt">How many outs do you have?</div>
        <div className="sub">
          Count the cards that complete your draw: the ones that give you a straight, a flush, or better.
        </div>

        <Felt>
          <Seat label="You">
            {spot.hero.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </Seat>
          <Divider />
          <Seat label="Board">
            {spot.board.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </Seat>
        </Felt>
        <div className="sub" style={{ textAlign: "center", margin: "6px 0 0" }}>
          You have <b>{question.drawLabel}</b>.
        </div>

        <div className="opts grid3">
          {question.options.map((value, i) => {
            let state: OptionButtonState = "idle";
            if (phase === "answered") {
              if (value === question.answer) state = "correct";
              else if (value === chosen) state = "wrong";
              else state = "disabled";
            }
            return (
              <OptionButton
                key={value}
                keyHint={String(i + 1)}
                state={state}
                onClick={() => handleAnswer(value)}
              >
                {value} out{value === 1 ? "" : "s"}
              </OptionButton>
            );
          })}
        </div>

        {phase === "answered" && (
          <FeedbackPanel ok={chosen === question.answer} message={chosen === question.answer ? "Correct." : "Not quite."}>
            <WorkTable>
              <WorkRow label="Your draw" value={spot.draw} />
              <WorkRow label="Unseen cards" value={question.unseen} />
              <WorkRow label="Outs" value={question.answer} />
              <WorkRow label={chanceLabel} value={question.hitPct} />
            </WorkTable>
            <div className="note">
              <b>Your outs:</b> {describeOuts(spot.outCards)}
            </div>
            <div className="note warnl">
              <b>Next step, when you are ready.</b> These are the cards that complete your draw.
              Against a real hand some of them can be <i>dead</i> — a card that makes your flush can
              pair the board and give them a full house. Face-up opponent mode arrives with the full
              drill set.
            </div>
          </FeedbackPanel>
        )}

        {phase === "answered" && (
          <div className="actions">
            <button className="btn" onClick={handleNext}>
              Next hand →
            </button>
            <span className="hint">
              or press <b>N</b> / Enter
            </span>
          </div>
        )}
      </div>
    </>
  );
}
