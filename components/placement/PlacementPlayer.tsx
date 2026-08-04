"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DrillPlayer } from "@/components/drill/DrillPlayer";
import {
  PLACEMENT_BLUEPRINT,
  PLACEMENT_QUESTION_COUNT,
  placementQuestions,
} from "@/lib/placement/blueprint";
import {
  completePlacement,
  recordPlacementResponse,
  skipPlacement,
  startPlacement,
} from "@/lib/placement/api";
import { KIND_LABELS } from "@/lib/drill/registry";
import { UNSURE, type OptionValue } from "@/lib/drill/contract";
import type { PlacementCompleteResult } from "@/lib/placement/types";

export interface PlacementPlayerProps {
  /**
   * Seed for the assessment, generated server-side. The first question renders
   * identically on the server and the client, so there is no hydration drift
   * and no mount effect deals the opening hand — the same technique DrillShell
   * uses. If the server returns a DIFFERENT seed because an assessment was
   * already in progress, the questions are re-dealt from that one.
   */
  seed: number;
}

type Phase = "asking" | "saving" | "done";

/**
 * The M8.5B placement assessment.
 *
 * Nine questions from the real drill generators, rendered by the real
 * `DrillPlayer`, so the assessment looks and behaves exactly like the practice
 * it places into — including the "Not sure" answer, which here is the most
 * useful response a new player can give.
 *
 * Nothing about it is a gate: Skip is on screen from the first question to the
 * last, and skipping lands on today's cold start rather than a penalty.
 */
export function PlacementPlayer({ seed: initialSeed }: PlacementPlayerProps) {
  const router = useRouter();
  const [seed, setSeed] = useState(initialSeed);
  const [assessmentId, setAssessmentId] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("asking");
  const [result, setResult] = useState<PlacementCompleteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept so the summary can report what happened without a refetch. Placement
  // is short enough that the whole run fits in memory.
  const [answered, setAnswered] = useState<{ correct: boolean; unsure: boolean }[]>([]);

  const questions = useMemo(() => placementQuestions(seed), [seed]);
  const question = questions[index];

  // Claim the assessment row once. The server may hand back an assessment that
  // was already in progress, with its own seed — adopting it is what makes a
  // reload resume rather than silently restart from a different question set.
  useEffect(() => {
    let cancelled = false;
    void startPlacement(initialSeed)
      .then((assessment) => {
        if (cancelled) return;
        setAssessmentId(assessment.id);
        if (assessment.seed !== initialSeed) setSeed(assessment.seed);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "The assessment could not be started.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialSeed]);

  const finish = useCallback(
    async (id: number) => {
      setPhase("saving");
      try {
        setResult(await completePlacement(id));
        setPhase("done");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The result could not be saved.");
        setPhase("asking");
      }
    },
    [router],
  );

  const handleAnswered = useCallback(
    (chosen: OptionValue, right: boolean) => {
      if (assessmentId === null) {
        // The start call has not landed yet. The answer is still shown and
        // explained; it simply does not count, which is better than blocking
        // a new player behind a network round trip.
        setError("Still connecting — this answer will not be counted.");
        return;
      }
      setAnswered((prev) => [...prev, { correct: right, unsure: chosen === UNSURE }]);
      void recordPlacementResponse(assessmentId, index, chosen, right).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "That answer could not be saved.");
      });
    },
    [assessmentId, index, question],
  );

  const handleNext = useCallback(() => {
    if (index + 1 < PLACEMENT_QUESTION_COUNT) {
      setIndex((i) => i + 1);
      return;
    }
    if (assessmentId !== null) void finish(assessmentId);
  }, [assessmentId, finish, index]);

  const handleSkip = useCallback(() => {
    if (assessmentId === null) {
      router.push("/");
      return;
    }
    setPhase("saving");
    void skipPlacement(assessmentId)
      .then(() => {
        // Skipping declines the placement, not the course. The player still
        // lands on the lessons — just un-placed, at module 1 and level 1,
        // which is exactly the cold start.
        router.push("/learn");
        router.refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The assessment could not be skipped.");
        setPhase("asking");
      });
  }, [assessmentId, router]);

  if (phase === "done" && result) {
    const correct = answered.filter((a) => a.correct).length;
    const entry = result.entry_module_index ?? 0;
    return (
      <main className="page-narrow placement-page">
        <section className="blueprint placement-result">
          <div className="mono-label accent">Placement complete</div>
          <h1>
            {correct} of {result.answered} right.
          </h1>
          <p>
            {entry === 0
              ? "Your path starts at the beginning — the foundations are worth the twenty minutes."
              : `Your path starts at module ${entry + 1}. The ${result.lessons_placed_out} lesson${result.lessons_placed_out === 1 ? "" : "s"} before it are marked as already known, and stay open if you want them.`}
          </p>
          <p className="text-dim">
            The drills you answered correctly start one level up. Nothing here counted
            toward your XP, streak or accuracy — placement is not practice.
          </p>
          <div className="placement-scores">
            {Object.values(result.scores)
              .filter((score) => score.asked > 0)
              .map((score) => (
                <div key={score.tag}>
                  <span>{score.tag.replaceAll("_", " ")}</span>
                  <strong>
                    {score.correct}/{score.asked}
                    {score.unsure > 0 && <em> · {score.unsure} not sure</em>}
                  </strong>
                </div>
              ))}
          </div>
          <div className="placement-actions">
            {/* Placement's job was to decide where the path starts, so it hands
                off to the path. The secondary goes to the dashboard rather than
                also to /learn — two buttons to one route is worse than either. */}
            <Link href="/learn" className="btn btn-primary blueprint btn-caps">
              Start learning
            </Link>
            <Link href="/" className="btn btn-secondary btn-caps">
              Go to your dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const item = PLACEMENT_BLUEPRINT[index];
  const pct = Math.round((index / PLACEMENT_QUESTION_COUNT) * 100);

  return (
    <main className="page-narrow placement-page">
      <header className="placement-head">
        <div>
          <div className="mono-label accent">Placement · one time, no XP</div>
          <h1>Nine questions, so we can start you in the right place.</h1>
          <p className="text-dim">
            Answer honestly — <b>Not sure</b> is a real answer here and tells us more than a
            lucky guess. You can skip this and take it later.
          </p>
        </div>
        <button className="btn btn-secondary btn-caps" onClick={handleSkip} disabled={phase === "saving"}>
          {phase === "saving" ? "Saving…" : "Skip for now"}
        </button>
      </header>

      <div className="placement-progress">
        <div className="lesson-progress-meta">
          <span>
            Question {index + 1} / {PLACEMENT_QUESTION_COUNT} · {KIND_LABELS[item.kind]}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
      </div>

      {error && <div className="note critl" role="alert">{error}</div>}

      <div className="blueprint" style={{ padding: "var(--space-6)" }}>
        <DrillPlayer
          // Keyed on the question: a new one remounts the player, which resets
          // its chosen-answer state without an effect.
          key={index}
          question={question}
          run={0}
          onAnswered={handleAnswered}
          onNext={handleNext}
          mode="assessment"
        />
      </div>
    </main>
  );
}
