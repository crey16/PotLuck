import Link from "next/link";
import { formatLessonTime, lessonTypeLabel } from "../../lib/learn/content";
import type { DailyContent } from "../../lib/learn/types";

/**
 * The daily item, once it has arrived.
 *
 * Extracted verbatim from `app/daily/page.tsx` when the read moved to the
 * browser: the markup is unchanged, so the page still looks the same the
 * moment the content lands.
 */
export function DailyCard({ daily }: { daily: DailyContent }) {
  const href = daily.lesson
    ? `/learn/${daily.lesson.module_id}/${daily.lesson.id}?daily=1`
    : `/learn/practice?daily=1&id=${daily.scenario?.id ?? ""}&skill=${encodeURIComponent(daily.scenario?.skill_tag ?? "")}&difficulty=${daily.scenario?.difficulty ?? 1}`;
  const title = daily.lesson?.title ?? daily.scenario?.scenario_json.prompt ?? "Practice hand";

  return (
    <>
      <div className="daily-kicker">
        <span className="mono-label accent">Daily lesson</span>
        <span>{daily.date}</span>
      </div>
      <section className="blueprint daily-feature">
        <div className="daily-feature-top">
          <div>
            <span className="tag tag-outline tag-mono">
              {daily.content_type === "lesson" ? "Lesson" : "Practice hand"}
            </span>
            <h1>{title}</h1>
          </div>
          <div className="daily-xp">
            <strong>+{daily.xp_reward}</strong>
            <span>daily XP</span>
          </div>
        </div>
        <div className="daily-meta">
          <span>{formatLessonTime(daily.estimated_time_seconds)}</span>
          {daily.lesson && <span>{lessonTypeLabel(daily.lesson.lesson_type)}</span>}
          {daily.lesson?.difficulty && <span>Difficulty {daily.lesson.difficulty}/3</span>}
        </div>
        {daily.is_completed && (
          <div className="note">Daily bonus already claimed. Replay stays open.</div>
        )}
        <Link href={href} className="btn btn-primary blueprint btn-caps">
          {daily.is_completed ? "Replay" : "Start daily lesson"}
        </Link>
      </section>
      <p className="daily-note">
        The item changes at midnight America/New_York. Finish it before the daily bonus is
        recorded.
      </p>
    </>
  );
}
