"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { OptionButton, type OptionButtonState } from "../ui/OptionButton";
import { NotSureOption } from "../ui/NotSureOption";
import { UNSURE } from "../../lib/drill/contract";
import { UNSURE_KEY, UNSURE_VERDICT } from "../../lib/drill/unsureUi";
import { completeDaily, getScenario, submitScenario } from "../../lib/learn/api";
import type {
  AuthoredScenario,
  DailyCompleteResult,
  ScenarioSubmitResult,
} from "../../lib/learn/types";

interface ScenarioPlayerProps {
  initialScenario: AuthoredScenario;
  filters: { moduleId?: number; difficulty?: number; skillTag?: string };
  daily: boolean;
}

export function ScenarioPlayer({ initialScenario, filters, daily }: ScenarioPlayerProps) {
  const [scenario, setScenario] = useState(initialScenario);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioSubmitResult | null>(null);
  const [dailyResult, setDailyResult] = useState<DailyCompleteResult | null>(null);
  const [pending, setPending] = useState(false);
  const [nextPending, setNextPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = scenario.scenario_json;
  const unsure = selectedId === UNSURE;

  const claimDaily = useCallback(async () => {
    if (!daily || dailyResult) return dailyResult;
    const completion = await completeDaily();
    setDailyResult(completion);
    return completion;
  }, [daily, dailyResult]);

  const handleAnswer = useCallback(
    async (choiceId: string) => {
      if (pending || result) return;
      setPending(true);
      setError(null);
      try {
        const submitted = await submitScenario(scenario.id, choiceId);
        setSelectedId(choiceId);
        setResult(submitted);
        if (daily) await claimDaily();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The answer could not be saved.");
      } finally {
        setPending(false);
      }
    }, [claimDaily, daily, pending, result, scenario.id]
  );

  const handleNext = useCallback(async () => {
    if (nextPending) return;
    setNextPending(true);
    setError(null);
    try {
      const next = await getScenario(filters);
      setScenario(next);
      setSelectedId(null);
      setResult(null);
      setDailyResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Another hand could not be loaded.");
    } finally {
      setNextPending(false);
    }
  }, [filters, nextPending]);

  const retryDaily = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await claimDaily();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The daily bonus could not be saved.");
    } finally {
      setPending(false);
    }
  }, [claimDaily, pending]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!result && !pending) {
        if (event.key === UNSURE_KEY) {
          event.preventDefault();
          void handleAnswer(UNSURE);
          return;
        }
        const index = Number(event.key) - 1;
        const choice = content.choices[index];
        if (choice) {
          event.preventDefault();
          void handleAnswer(choice.id);
        }
      } else if (result && (event.key === "Enter" || event.key.toUpperCase() === "N") && !daily) {
        event.preventDefault();
        void handleNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [content.choices, daily, handleAnswer, handleNext, pending, result]);

  return (
    <main className="page-narrow scenario-page">
      <div className="learn-breadcrumb"><Link href="/learn">Learn</Link><span>/</span><span>Practice hand</span></div>
      <header className="scenario-head">
        <div>
          <div className="mono-label accent">Authored decision · {scenario.skill_tag.replaceAll("_", " ")}</div>
          <h1>{content.prompt}</h1>
        </div>
        <div className="scenario-difficulty"><span>Difficulty</span><strong>{scenario.difficulty}/3</strong></div>
      </header>

      <section className="felt authored-felt">
        <div className="seat">
          <div className="who accent">Your hand</div>
          <div className="hand">{content.hero_cards.map((card) => <span className="authored-card" key={card}>{card}</span>)}</div>
        </div>
        {content.board.length > 0 && <div className="divider" />}
        {content.board.length > 0 && (
          <div className="seat">
            <div className="who">Board · {content.street}</div>
            <div className="hand">{content.board.map((card) => <span className="authored-card" key={card}>{card}</span>)}</div>
          </div>
        )}
      </section>

      <div className="scenario-facts">
        {Object.entries(content.game_state).map(([label, value]) => (
          <div key={label}><span>{label.replaceAll("_", " ")}</span><strong>{String(value)}</strong></div>
        ))}
        {content.villain_archetype && <div><span>Villain</span><strong>{content.villain_archetype}</strong></div>}
      </div>

      <div className="opts lesson-options">
        {content.choices.map((choice, index) => {
          let state: OptionButtonState = "idle";
          if (pending) state = "disabled";
          else if (result) {
            if (choice.id === result.correct_choice_id) state = "correct";
            else if (choice.id === selectedId) state = "wrong";
            else state = "disabled";
          }
          return (
            <OptionButton key={choice.id} keyHint={String(index + 1)} state={state} onClick={() => void handleAnswer(choice.id)}>
              {choice.label}
            </OptionButton>
          );
        })}
      </div>

      <NotSureOption
        answered={pending || result !== null}
        picked={unsure}
        onClick={() => void handleAnswer(UNSURE)}
      />

      {result && (
        <div className={`fb${result.is_correct || result.is_acceptable ? "" : " no"}${unsure ? " unsure" : ""}`}>
          <div className="bar">
            <span className="glyph">{result.is_correct || result.is_acceptable ? "✓" : unsure ? "?" : "×"}</span>
            <span className="word">{result.is_correct ? "Correct" : result.is_acceptable ? "Also fine" : unsure ? UNSURE_VERDICT : "Not quite"}</span>
            <span className="xp">+{result.xp_awarded + (dailyResult?.xp_awarded ?? 0)} XP</span>
          </div>
          <div className="body scenario-feedback">
            <div><span className="mono-label">Why</span><p>{result.explanation}</p></div>
            <div className="note"><b>Rule of thumb </b>{result.rule_of_thumb}</div>
            {daily && dailyResult && <div className="note">Daily bonus: +{dailyResult.xp_awarded} XP{dailyResult.already_completed ? " (already claimed)" : ""}</div>}
            <div className="actions">
              {daily ? (
                <Link href="/daily" className="btn btn-primary blueprint btn-caps">Back to daily</Link>
              ) : (
                <button className="btn btn-primary blueprint btn-caps" onClick={() => void handleNext()} disabled={nextPending}>
                  {nextPending ? "Loading…" : "Next hand"}<span className="keyhint">N</span>
                </button>
              )}
              <Link href="/learn" className="btn btn-secondary btn-caps">Course map</Link>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="note critl scenario-error" role="alert">
          {error}
          {daily && result && !dailyResult && (
            <button className="btn btn-secondary btn-caps" onClick={() => void retryDaily()} disabled={pending}>
              {pending ? "Saving…" : "Retry daily bonus"}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
