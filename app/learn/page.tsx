import type { Metadata } from "next";
import Link from "next/link";
import { fetchLearningPath, fetchServerRecommendation } from "../../lib/learn/server";
import { formatLessonTime } from "../../lib/learn/content";
import type { Recommendation } from "../../lib/learn/types";

export const metadata: Metadata = {
  title: "Learn · PotLuck",
  description: "A five-module learning path from poker foundations to disciplined decisions.",
};

function recommendationHref(recommendation: Recommendation): string {
  if (recommendation.type === "lesson" && recommendation.lesson_id && recommendation.module_id) {
    return `/learn/${recommendation.module_id}/${recommendation.lesson_id}`;
  }
  if (recommendation.type === "scenario") {
    const params = new URLSearchParams();
    if (recommendation.scenario_id) params.set("id", String(recommendation.scenario_id));
    if (recommendation.skill_tag) params.set("skill", recommendation.skill_tag);
    if (recommendation.difficulty) params.set("difficulty", String(recommendation.difficulty));
    return `/learn/practice${params.size ? `?${params}` : ""}`;
  }
  return "/learn";
}

export default async function LearnPage() {
  const [path, recommendation] = await Promise.all([
    fetchLearningPath(),
    fetchServerRecommendation(),
  ]);
  const totalLessons = path.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  const completedLessons = path.completedLessonIds.size;
  const coursePct = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return (
    <main className="page learn-page">
      <div className="learn-hero">
        <div>
          <div className="mono-label accent">Five-module course · authored lessons</div>
          <h1>Learn the decision before you drill it.</h1>
          <p>
            Short reads, checks, and retries build the idea. The drill room makes it automatic.
            Every lesson stays open for replay.
          </p>
          <div className="learn-course-progress">
            <div className="lesson-progress-meta">
              <span>{completedLessons} / {totalLessons} lessons</span>
              <span>{coursePct}% complete</span>
            </div>
            <div className="meter"><i style={{ width: `${coursePct}%` }} /></div>
          </div>
        </div>

        <div className="learn-hero-actions">
          <section className="blueprint learn-next-card">
            <div className="mono-label accent">Learn next</div>
            <h2>{recommendation.lesson?.title ?? (recommendation.type === "scenario" ? "Practice hand" : "Course map")}</h2>
            <p>{recommendation.reason}</p>
            {recommendation.type !== "none" && (
              <Link href={recommendationHref(recommendation)} className="btn btn-primary blueprint btn-caps">
                Continue
              </Link>
            )}
          </section>
          <Link href="/daily" className="blueprint daily-mini-card">
            <div><span className="mono-label">Daily</span><strong>One decision today</strong></div>
            <span>+15 XP →</span>
          </Link>
        </div>
      </div>

      <div className="section-head learn-section-head">
        <h2>Course map</h2>
        <span className="lede">Foundations through bankroll discipline. No gates; follow the sequence or revisit any plate.</span>
      </div>

      <div className="learn-labs-grid">
        <Link href="/learn/practice" className="blueprint learn-lab-card">
          <div className="mono-label accent">Practice lab 01</div>
          <h2>Authored hands</h2>
          <p>Read the complete spot, commit to one choice, and get the rule behind it.</p>
          <span>Start practice →</span>
        </Link>
        <Link href="/learn/table" className="blueprint learn-lab-card">
          <div className="mono-label accent">Practice lab 02</div>
          <h2>Table decisions</h2>
          <p>Reconstruct position, action, stack depth, and board before choosing the line.</p>
          <span>Take a seat →</span>
        </Link>
      </div>

      {path.error && <div className="note critl" role="alert">{path.error}</div>}
      {!path.error && path.modules.length === 0 && (
        <div className="blueprint learn-empty">
          <div className="mono-label accent">Content seed required</div>
          <h2>The learning tables are ready, but empty.</h2>
          <p>Apply <code>supabase/seed.sql</code> to load the five-module course.</p>
        </div>
      )}

      <div className="course-map">
        {path.modules.map((module, index) => {
          const total = module.lessons.length;
          const pct = total ? Math.round((module.completedCount / total) * 100) : 0;
          const nextLesson = module.lessons.find((lesson) => lesson.id === module.nextLessonId);
          const complete = total > 0 && module.completedCount === total;
          return (
            <div className="course-map-row" key={module.id}>
              <div className={`course-node${complete ? " complete" : ""}`}>
                {complete ? "✓" : String(index + 1).padStart(2, "0")}
              </div>
              {index < path.modules.length - 1 && <span className="course-line" aria-hidden="true" />}
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
    </main>
  );
}
