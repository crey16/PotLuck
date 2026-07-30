"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getTableScenario, submitTableScenario } from "../../lib/learn/api";
import type { ScenarioSubmitResult, TableScenario } from "../../lib/learn/types";
import { OptionButton, type OptionButtonState } from "../ui/OptionButton";

interface TableScenarioPlayerProps {
  initialScenario: TableScenario;
  filters: { moduleId?: number; difficulty?: number; skillTag?: string };
}

const SEAT_POSITION: Record<number, string> = {
  1: "SB",
  2: "BB",
  3: "UTG",
  4: "HJ",
  5: "CO",
  6: "BTN",
};

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function cardFace(card: string): { label: string; red: boolean } {
  const suitCode = card.slice(-1).toLowerCase();
  const rank = card.slice(0, -1).toUpperCase();
  return {
    label: `${rank}${SUIT[suitCode] ?? suitCode}`,
    red: suitCode === "h" || suitCode === "d",
  };
}

function actionLabel(action: TableScenario["situation"]["pre_action"][number]): string {
  const amount = action.amount_bb == null ? "" : ` ${action.amount_bb}bb`;
  return `${SEAT_POSITION[action.seat] ?? `Seat ${action.seat}`} · ${action.action}${amount}`;
}

export function TableScenarioPlayer({ initialScenario, filters }: TableScenarioPlayerProps) {
  const [scenario, setScenario] = useState(initialScenario);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioSubmitResult | null>(null);
  const [pending, setPending] = useState(false);
  const [nextPending, setNextPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { situation } = scenario;
  const lastAction = situation.pre_action.at(-1);
  const potAtDecision =
    (situation.pot_bb ?? 0) +
    (lastAction?.action === "bet" ? (lastAction.amount_bb ?? 0) : 0);

  const handleAnswer = useCallback(async (choiceId: string) => {
    if (pending || result) return;
    setPending(true);
    setError(null);
    try {
      const submitted = await submitTableScenario(scenario.id, choiceId);
      setSelectedId(choiceId);
      setResult(submitted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be saved.");
    } finally {
      setPending(false);
    }
  }, [pending, result, scenario.id]);

  const handleNext = useCallback(async () => {
    if (nextPending) return;
    setNextPending(true);
    setError(null);
    try {
      const next = await getTableScenario(filters);
      setScenario(next);
      setSelectedId(null);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Another table spot could not be loaded.");
    } finally {
      setNextPending(false);
    }
  }, [filters, nextPending]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!result && !pending) {
        const choice = scenario.choices[Number(event.key) - 1];
        if (choice) {
          event.preventDefault();
          void handleAnswer(choice.id);
        }
      } else if (result && (event.key === "Enter" || event.key.toUpperCase() === "N")) {
        event.preventDefault();
        void handleNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAnswer, handleNext, pending, result, scenario.choices]);

  return (
    <main className="page-narrow scenario-page table-scenario-page">
      <div className="learn-breadcrumb"><Link href="/learn">Learn</Link><span>/</span><span>Table decision</span></div>
      <header className="scenario-head">
        <div>
          <div className="mono-label accent">Table lab · {scenario.skill_tag.replaceAll("_", " ")} · {scenario.street}</div>
          <h1>{scenario.prompt_title}</h1>
        </div>
        <div className="scenario-difficulty"><span>Difficulty</span><strong>{scenario.difficulty}/3</strong></div>
      </header>

      <section className="table-blueprint felt" aria-label="Poker table situation">
        <div className="table-center">
          <div className="mono-label">Pot now</div>
          <strong>{potAtDecision}bb</strong>
          {situation.board.length > 0 && (
            <div className="table-board" aria-label="Board cards">
              {situation.board.map((card) => {
                const face = cardFace(card);
                return <span className={`authored-card${face.red ? " red" : ""}`} key={card}>{face.label}</span>;
              })}
            </div>
          )}
        </div>
        {situation.villains.map((villain, index) => (
          <div className={`table-person villain table-person-${Math.min(index + 1, 3)}`} key={`${villain.seat}-${index}`}>
            <span>{villain.label ?? "Villain"} · {villain.position}</span>
            <strong>{villain.style ?? "unknown"}</strong>
          </div>
        ))}
        <div className="table-person hero">
          <span>You · {situation.hero.position}</span>
          <div className="table-hole-cards">
            {situation.hero.cards.map((card) => {
              const face = cardFace(card);
              return <span className={`authored-card${face.red ? " red" : ""}`} key={card}>{face.label}</span>;
            })}
          </div>
        </div>
      </section>

      <div className="scenario-facts table-facts">
        <div><span>Effective stack</span><strong>{situation.effective_stack_bb ?? "—"}bb</strong></div>
        <div><span>Blinds</span><strong>{situation.blinds?.sb ?? "—"} / {situation.blinds?.bb ?? "—"}</strong></div>
        <div><span>Hero seat</span><strong>{situation.hero.position}</strong></div>
        <div><span>Street</span><strong>{scenario.street}</strong></div>
      </div>

      {situation.pre_action.length > 0 && (
        <section className="blueprint action-ledger" aria-label="Action before your decision">
          <div className="mono-label">Action before you</div>
          <ol>
            {situation.pre_action.map((action, index) => <li key={`${action.seat}-${index}`}>{actionLabel(action)}</li>)}
          </ol>
        </section>
      )}

      <div className="opts lesson-options">
        {scenario.choices.map((choice, index) => {
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

      {result && (
        <div className={`fb${result.is_correct || result.is_acceptable ? "" : " no"}`}>
          <div className="bar">
            <span className="glyph">{result.is_correct || result.is_acceptable ? "✓" : "×"}</span>
            <span className="word">{result.is_correct ? "Correct" : result.is_acceptable ? "Also fine" : "Not quite"}</span>
            <span className="xp">+{result.xp_awarded} XP</span>
          </div>
          <div className="body scenario-feedback">
            <div><span className="mono-label">Why</span><p>{result.explanation}</p></div>
            <div className="note"><b>Rule of thumb </b>{result.rule_of_thumb}</div>
            <div className="actions">
              <button className="btn btn-primary blueprint btn-caps" onClick={() => void handleNext()} disabled={nextPending}>
                {nextPending ? "Loading…" : "Next table spot"}<span className="keyhint">N</span>
              </button>
              <Link href="/learn" className="btn btn-secondary btn-caps">Course map</Link>
            </div>
          </div>
        </div>
      )}

      {error && <div className="note critl scenario-error" role="alert">{error}</div>}
    </main>
  );
}
