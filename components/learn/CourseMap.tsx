import Link from "next/link";
import { formatLessonTime } from "../../lib/learn/content";
import type { ModuleWithProgress } from "../../lib/learn/types";

export interface CourseMapProps {
  modules: ModuleWithProgress[];
  /** Lessons the player has finished, so each row can mark its next one. */
  completedLessonIds: Set<number>;
}

/**
 * The ONE module/lesson list.
 *
 * `/learn` is the only route that renders it. M8.5A briefly put it on `/` too
 * and that was reverted — steering new players is a routing job, not a reason
 * to restructure the dashboard. If it ever needs to appear somewhere else,
 * render THIS component there; do not paste the markup. Two copies would
 * silently disagree about completion the first time either changed, and
 * `coursePathSingleSource.test.ts` fails if a route re-declares these classes.
 *
 * Server component, no state, no client boundary — everything it shows is
 * already derived by `fetchLearningPath`.
 */
export function CourseMap({ modules, completedLessonIds }: CourseMapProps) {
  return (
    <div className="course-map">
      {modules.map((module, index) => {
        const total = module.lessons.length;
        const pct = total ? Math.round((module.completedCount / total) * 100) : 0;
        const complete = total > 0 && module.completedCount === total;
        // The module's own next lesson, computed the same way the path-wide
        // step is: the first lesson not yet completed. The precomputed field
        // on ModuleWithProgress is deliberately NOT used — it falls back to
        // the module's first lesson once the module is finished, which would
        // print "Next: <lesson 1>" underneath a module marked complete.
        const nextLesson = module.lessons.find((lesson) => !completedLessonIds.has(lesson.id));
        return (
          <div className="course-map-row" key={module.id}>
            <div className={`course-node${complete ? " complete" : ""}`}>
              {complete ? "✓" : String(index + 1).padStart(2, "0")}
            </div>
            {index < modules.length - 1 && <span className="course-line" aria-hidden="true" />}
            <article className={`blueprint course-module${complete ? " complete" : ""}`}>
              <div className="course-module-head">
                <div>
                  <div className="mono-label accent">Module {String(index + 1).padStart(2, "0")}</div>
                  <h2>{module.title}</h2>
                </div>
                <div className="course-module-count">
                  <strong>{module.completedCount}/{total}</strong>
                  <span>lessons</span>
                </div>
              </div>
              <p>{module.description}</p>
              <div className="meter"><i style={{ width: `${pct}%` }} /></div>
              <div className="course-module-foot">
                <span>
                  {complete
                    ? "Module complete · replay any lesson"
                    : nextLesson
                      ? `Next: ${nextLesson.title} · ${formatLessonTime(nextLesson.estimatedSeconds)}`
                      : "No lessons loaded"}
                </span>
                <Link href={`/learn/${module.id}`} className="btn btn-secondary btn-caps">
                  Open module
                </Link>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
