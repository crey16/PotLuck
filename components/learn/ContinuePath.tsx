import Link from "next/link";
import { formatLessonTime } from "../../lib/learn/content";
import { lessonHref, type PathProgress, type PathStep } from "../../lib/learn/path";

export interface ContinuePathProps {
  step: PathStep | null;
  progress: PathProgress;
}

/**
 * The path's single unambiguous "continue" action.
 *
 * One primary button, always — never a row of equally-weighted choices, which
 * is what turns a learning path back into a menu. Rendered by `/learn` only;
 * see `CourseMap` for why the home page does not carry the path.
 */
export function ContinuePath({ step, progress }: ContinuePathProps) {
  const done = step === null && progress.total > 0;
  return (
    <section className="blueprint continue-path">
      <div className="mono-label accent">
        {done ? "Course complete" : progress.completed === 0 ? "Start here" : "Continue where you left off"}
      </div>
      <h2>
        {done
          ? "Every lesson is done."
          : step
            ? step.lesson.title
            : "The learning path is not loaded yet."}
      </h2>
      <p>
        {done
          ? "Replay any lesson, or keep the numbers sharp in the drill room."
          : step
            ? `${step.module.title} · ${formatLessonTime(step.lesson.estimatedSeconds)}`
            : "Once the course content is available, your next lesson appears here."}
      </p>

      <div className="continue-path-progress">
        <div className="lesson-progress-meta">
          <span>{progress.completed} / {progress.total} lessons</span>
          <span>{progress.pct}% complete</span>
        </div>
        <div className="meter"><i style={{ width: `${progress.pct}%` }} /></div>
      </div>

      {step ? (
        <Link
          href={lessonHref(step.module.id, step.lesson.id)}
          className="btn btn-primary blueprint btn-caps continue-path-cta"
        >
          {progress.completed === 0 ? "Start the first lesson" : "Continue lesson"}
        </Link>
      ) : (
        <Link href="/learn" className="btn btn-secondary btn-caps continue-path-cta">
          Open the course map
        </Link>
      )}
    </section>
  );
}
