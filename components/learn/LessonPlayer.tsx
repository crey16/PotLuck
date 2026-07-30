"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { OptionButton, type OptionButtonState } from "../ui/OptionButton";
import { LessonMarkdown } from "./LessonMarkdown";
import { completeDaily, completeLesson, recordLessonAttempt } from "../../lib/learn/api";
import { formatLessonTime, lessonTypeLabel } from "../../lib/learn/content";
import type {
  DailyCompleteResult,
  LearningModule,
  Lesson,
  LessonCompleteResult,
} from "../../lib/learn/types";

interface LessonPlayerProps {
  module: LearningModule;
  lesson: Lesson;
  initiallyCompleted: boolean;
  daily?: boolean;
}

function ignoresShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable)
  );
}

export function LessonPlayer({
  module,
  lesson,
  initiallyCompleted,
  daily = false,
}: LessonPlayerProps) {
  const router = useRouter();
  const [screenIndex, setScreenIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const [answerPending, setAnswerPending] = useState(false);
  const [finishPending, setFinishPending] = useState(false);
  const [lessonCompletion, setLessonCompletion] = useState<LessonCompleteResult | null>(null);
  const [dailyCompletion, setDailyCompletion] = useState<DailyCompleteResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const screens = lesson.content.screens;
  const screen = screens[screenIndex];
  const answered = selectedId !== null && answerCorrect !== null;
  const canContinue =
    screen.type === "info" ||
    screen.type === "recap" ||
    (screen.type === "question" && answered) ||
    (screen.type === "drill" && answerCorrect === true);
  const isLast = screenIndex === screens.length - 1;

  const handleFinish = useCallback(async () => {
    if (finishPending) return;
    setFinishPending(true);
    setError(null);
    try {
      let savedLesson = lessonCompletion;
      if (!savedLesson) {
        savedLesson = await completeLesson(lesson.id);
        setLessonCompletion(savedLesson);
      }
      if (daily && !dailyCompletion) {
        const savedDaily = await completeDaily();
        setDailyCompletion(savedDaily);
      }
      setFinished(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Progress could not be saved.");
    } finally {
      setFinishPending(false);
    }
  }, [daily, dailyCompletion, finishPending, lesson.id, lessonCompletion, router]);

  const handleContinue = useCallback(() => {
    if (!canContinue || finishPending) return;
    if (isLast) {
      void handleFinish();
      return;
    }
    setScreenIndex((index) => index + 1);
    setSelectedId(null);
    setAnswerCorrect(null);
    setError(null);
  }, [canContinue, finishPending, handleFinish, isLast]);

  const handleSelect = useCallback(
    async (choiceId: string) => {
      if (answerPending) return;
      if (screen.type !== "question" && screen.type !== "drill") return;
      if (screen.type === "question" && answered) return;
      if (screen.type === "drill" && answerCorrect === true) return;
      setAnswerPending(true);
      setError(null);
      try {
        const result = await recordLessonAttempt(lesson.id, screenIndex, choiceId);
        setSelectedId(choiceId);
        setAnswerCorrect(result.is_correct);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The answer could not be saved.");
      } finally {
        setAnswerPending(false);
      }
    }, [answerCorrect, answerPending, answered, lesson.id, screen.type, screenIndex]
  );

  const retryDrill = useCallback(() => {
    setSelectedId(null);
    setAnswerCorrect(null);
    setError(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (ignoresShortcut(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        router.push(`/learn/${module.id}`);
        return;
      }
      if (
        (screen.type === "question" || screen.type === "drill") &&
        !answered &&
        !answerPending
      ) {
        const optionIndex = Number(event.key) - 1;
        const choice = screen.choices?.[optionIndex];
        if (choice) {
          event.preventDefault();
          void handleSelect(choice.id);
        }
      } else if ((event.key === "Enter" || event.key.toUpperCase() === "N") && canContinue) {
        event.preventDefault();
        handleContinue();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answerPending, answered, canContinue, handleContinue, handleSelect, module.id, router, screen]);

  if (finished && lessonCompletion) {
    const dailyXp = dailyCompletion?.xp_awarded ?? 0;
    const totalEarned = lessonCompletion.xp_earned + dailyXp;
    return (
      <main className="page-narrow lesson-finish-page">
        <section className="blueprint lesson-finish">
          <div className="lesson-complete-mark" aria-hidden="true">✓</div>
          <div className="mono-label accent">Lesson complete</div>
          <h1>{lesson.title}</h1>
          <p className="text-dim">
            {lessonCompletion.already_completed
              ? "Replay saved. Lesson XP is awarded only once."
              : "Progress saved to your learning path."}
          </p>
          <div className="lesson-finish-stats">
            <div><span>XP earned</span><strong>+{totalEarned}</strong></div>
            <div><span>First-try score</span><strong>{lessonCompletion.score}%</strong></div>
            <div><span>Day streak</span><strong>{dailyCompletion?.streak_count ?? lessonCompletion.streak_count}</strong></div>
          </div>
          {daily && (
            <div className="note" style={{ marginTop: "var(--space-4)" }}>
              Daily bonus: +{dailyXp} XP{dailyCompletion?.already_completed ? " (already claimed)" : ""}
            </div>
          )}
          <div className="lesson-finish-actions">
            <Link href={`/learn/${module.id}`} className="btn btn-primary blueprint btn-caps">
              Back to {module.title}
            </Link>
            <Link href="/learn" className="btn btn-secondary btn-caps">Course map</Link>
          </div>
        </section>
      </main>
    );
  }

  const progress = ((screenIndex + 1) / screens.length) * 100;
  const correctChoice = screen.choices?.find((choice) => choice.id === screen.correct_choice_id);

  return (
    <main className="page-narrow lesson-player-page">
      <div className="lesson-player-top">
        <Link href={`/learn/${module.id}`} className="lesson-close" aria-label={`Back to ${module.title}`}>×</Link>
        <div className="lesson-progress-wrap">
          <div className="lesson-progress-meta">
            <span>{module.title}</span>
            <span>{screenIndex + 1} / {screens.length}</span>
          </div>
          <div className="meter"><i style={{ width: `${progress}%` }} /></div>
        </div>
        <span className="keycap">Esc</span>
      </div>

      <div className="lesson-player-grid">
        <section>
          <div className="lesson-screen-meta">
            <span className="tag tag-outline tag-mono">
              {screen.type === "question" ? "Knowledge check" : screen.type}
            </span>
            {initiallyCompleted && <span className="tag tag-neutral tag-mono">Replay</span>}
          </div>
          <article className={`blueprint lesson-content${screen.type === "recap" ? " recap" : ""}`}>
            {screen.type === "recap" && <div className="mono-label accent">Key takeaway</div>}
            <LessonMarkdown>{screen.content}</LessonMarkdown>
          </article>

          {(screen.type === "question" || screen.type === "drill") && (
            <div className="opts lesson-options">
              {screen.choices?.map((choice, index) => {
                let state: OptionButtonState = "idle";
                if (answerPending) state = "disabled";
                else if (answered) {
                  if (choice.id === screen.correct_choice_id) state = "correct";
                  else if (choice.id === selectedId) state = "wrong";
                  else state = "disabled";
                }
                return (
                  <OptionButton
                    key={choice.id}
                    keyHint={String(index + 1)}
                    state={state}
                    onClick={() => void handleSelect(choice.id)}
                  >
                    {choice.label}
                  </OptionButton>
                );
              })}
            </div>
          )}

          {answered && (screen.type === "question" || screen.type === "drill") && (
            <div className={`fb${answerCorrect ? "" : " no"}`}>
              <div className="bar">
                <span className="glyph">{answerCorrect ? "✓" : "×"}</span>
                <span className="word">{answerCorrect ? "Correct" : "Not quite"}</span>
                <span className="xp">
                  {!answerCorrect && correctChoice ? `Answer: ${correctChoice.label}` : "Attempt saved"}
                </span>
              </div>
              <div className="body">
                <p style={{ margin: 0 }}>
                  {screen.type === "drill" && !answerCorrect
                    ? "Try it again before moving on."
                    : answerCorrect
                      ? "Good. Keep the decision rule, not just this answer."
                      : "Review the answer, then continue—the lesson will reinforce it."}
                </p>
              </div>
            </div>
          )}

          {error && <div className="note critl lesson-save-error" role="alert">{error}</div>}

          <div className="lesson-actions">
            {screen.type === "drill" && answered && !answerCorrect ? (
              <button className="btn btn-primary blueprint btn-caps" onClick={retryDrill}>
                Try again
              </button>
            ) : (
              <button
                className="btn btn-primary blueprint btn-caps"
                disabled={!canContinue || finishPending}
                onClick={handleContinue}
              >
                {finishPending ? "Saving…" : isLast ? "Finish lesson" : "Continue"}
                {canContinue && !finishPending && <span className="keyhint">N</span>}
              </button>
            )}
            <span className="hint">{canContinue ? "or Enter" : "Choose an answer"}</span>
          </div>
        </section>

        <aside className="lesson-rail">
          <div className="blueprint lesson-rail-card">
            <div className="mono-label">Lesson</div>
            <h1>{lesson.title}</h1>
            <div className="lesson-rail-meta">
              <span>{lessonTypeLabel(lesson.type)}</span>
              <span>{formatLessonTime(lesson.estimatedSeconds)}</span>
              <span>{lesson.content.xp_reward} XP</span>
            </div>
          </div>
          <div className="blueprint lesson-outline">
            <div className="mono-label">Outline</div>
            {screens.map((item, index) => (
              <div
                className={`lesson-outline-row${index === screenIndex ? " current" : ""}${index < screenIndex ? " done" : ""}`}
                key={index}
              >
                <span>{index < screenIndex ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <b>{item.type === "question" ? "Check" : item.type}</b>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
