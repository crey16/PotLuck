import type { Metadata } from "next";
import Link from "next/link";
import { fetchLearningPath, fetchServerRecommendation } from "../../lib/learn/server";
import { nextPathStep, pathProgress, recommendationHref } from "../../lib/learn/path";
import { ContinuePath } from "../../components/learn/ContinuePath";
import { CourseMap } from "../../components/learn/CourseMap";

export const metadata: Metadata = {
  title: "Learn · PotLuck",
  description: "A five-module learning path from poker foundations to disciplined decisions.",
};

/**
 * The learning path — the only route that renders it.
 *
 * It is also where new-player routing lands: signup goes to `/`, which sends a
 * brand-new account through `/placement`, which hands off here. `/` itself is
 * the dashboard and carries no course map (see `components/learn/CourseMap`).
 */
export default async function LearnPage() {
  const [path, recommendation] = await Promise.all([
    fetchLearningPath(),
    fetchServerRecommendation(),
  ]);
  const progress = pathProgress(path);
  const step = nextPathStep(path);

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
        </div>

        <div className="learn-hero-actions">
          <ContinuePath step={step} progress={progress} />
          <Link href="/daily" className="blueprint daily-mini-card">
            <div><span className="mono-label">Daily</span><strong>One decision today</strong></div>
            <span>+15 XP →</span>
          </Link>
        </div>
      </div>

      {recommendation.type !== "none" && (
        <section className="blueprint recommended-practice">
          <div>
            <div className="mono-label">Recommended practice</div>
            <strong>
              {recommendation.lesson?.title ??
                (recommendation.type === "scenario" ? "Authored practice hand" : "Course map")}
            </strong>
            <span>{recommendation.reason}</span>
          </div>
          <Link href={recommendationHref(recommendation)} className="btn btn-secondary btn-caps">
            Practice this
          </Link>
        </section>
      )}

      <div className="section-head learn-section-head">
        <h2>Course map</h2>
        <span className="lede">
          Foundations through bankroll discipline. No gates; follow the sequence or revisit any plate.{" "}
          {/* M8.5B: placement is retakeable from here, so a player who skipped
              it — or whose game has moved on — is never stuck with a cold start. */}
          <Link href="/placement">Take the placement assessment</Link> to move where the path starts.
        </span>
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

      <CourseMap modules={path.modules} completedLessonIds={path.completedLessonIds} />
    </main>
  );
}
