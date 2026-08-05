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
 * M8.6B turned this from five full-width stacked cards into a responsive grid.
 * The stack pushed the last modules well below the fold, and adding the
 * Bluffing module would have made a long page longer. The grid shows the whole
 * path at once and absorbs a sixth module without growing.
 *
 * The vertical spine that used to connect the modules went with the stack: a
 * single line only reads as "this comes after that" in one column, and in a
 * grid it would have implied an order that wraps. The numbered badge on each
 * card carries the sequence instead.
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
            <article className={`blueprint course-module${complete ? " complete" : ""}`}>
              <div className="course-module-head">
                <div className={`course-node${complete ? " complete" : ""}`}>
                  {complete ? "✓" : String(index + 1).padStart(2, "0")}
                </div>
                <h2>{module.title}</h2>
                <div className="course-module-count">
                  <strong>{module.completedCount}/{total}</strong>
                  <span>lessons</span>
                </div>
              </div>
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
                  Open
                </Link>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
