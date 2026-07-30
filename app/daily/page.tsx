import type { Metadata } from "next";
import Link from "next/link";
import { fetchDailyServer } from "../../lib/learn/serverApi";
import { formatLessonTime, lessonTypeLabel } from "../../lib/learn/content";

export const metadata: Metadata = { title: "Daily lesson · PotLuck" };

export default async function DailyPage() {
  const daily = await fetchDailyServer();
  if (!daily) {
    return (
      <main className="page-narrow daily-page">
        <div className="blueprint learn-empty">
          <div className="mono-label accent">Daily unavailable</div>
          <h1>Today’s lesson could not be loaded.</h1>
          <p>The API may still be starting, or the learning seed has not been applied.</p>
          <Link href="/daily" className="btn btn-primary blueprint btn-caps">Try again</Link>
        </div>
      </main>
    );
  }

  const href = daily.lesson
    ? `/learn/${daily.lesson.module_id}/${daily.lesson.id}?daily=1`
    : `/learn/practice?daily=1&id=${daily.scenario?.id ?? ""}&skill=${encodeURIComponent(daily.scenario?.skill_tag ?? "")}&difficulty=${daily.scenario?.difficulty ?? 1}`;
  const title = daily.lesson?.title ?? daily.scenario?.scenario_json.prompt ?? "Practice hand";

  return (
    <main className="page-narrow daily-page">
      <div className="daily-kicker"><span className="mono-label accent">Daily lesson</span><span>{daily.date}</span></div>
      <section className="blueprint daily-feature">
        <div className="daily-feature-top">
          <div>
            <span className="tag tag-outline tag-mono">{daily.content_type === "lesson" ? "Lesson" : "Practice hand"}</span>
            <h1>{title}</h1>
          </div>
          <div className="daily-xp"><strong>+{daily.xp_reward}</strong><span>daily XP</span></div>
        </div>
        <div className="daily-meta">
          <span>{formatLessonTime(daily.estimated_time_seconds)}</span>
          {daily.lesson && <span>{lessonTypeLabel(daily.lesson.lesson_type)}</span>}
          {daily.lesson?.difficulty && <span>Difficulty {daily.lesson.difficulty}/3</span>}
        </div>
        {daily.is_completed && <div className="note">Daily bonus already claimed. Replay stays open.</div>}
        <Link href={href} className="btn btn-primary blueprint btn-caps">
          {daily.is_completed ? "Replay" : "Start daily lesson"}
        </Link>
      </section>
      <p className="daily-note">The item changes at midnight America/New_York. Finish it before the daily bonus is recorded.</p>
    </main>
  );
}
