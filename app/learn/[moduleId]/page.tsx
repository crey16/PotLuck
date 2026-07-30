import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchModule } from "../../../lib/learn/server";
import { formatLessonTime, lessonTypeLabel } from "../../../lib/learn/content";

export async function generateMetadata({ params }: { params: Promise<{ moduleId: string }> }): Promise<Metadata> {
  const { moduleId } = await params;
  const id = Number(moduleId);
  const data = Number.isInteger(id) ? await fetchModule(id) : null;
  return { title: data ? `${data.module.title} · Learn · PotLuck` : "Module · PotLuck" };
}

export default async function ModulePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const id = Number(moduleId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await fetchModule(id);
  if (!data) notFound();

  const completedCount = data.lessons.filter((lesson) => data.completedLessonIds.has(lesson.id)).length;
  const pct = data.lessons.length ? Math.round((completedCount / data.lessons.length) * 100) : 0;
  const nextLessonId = data.lessons.find((lesson) => !data.completedLessonIds.has(lesson.id))?.id ?? null;

  return (
    <main className="page-narrow module-page">
      <div className="learn-breadcrumb">
        <Link href="/learn">Learn</Link><span>/</span><span>{data.module.title}</span>
      </div>
      <header className="module-hero">
        <div>
          <div className="mono-label accent">Module {String(data.module.order).padStart(2, "0")}</div>
          <h1>{data.module.title}</h1>
          <p>{data.module.description}</p>
        </div>
        <div className="blueprint module-progress-card">
          <div className="mono-label">Module progress</div>
          <strong>{pct}%</strong>
          <span>{completedCount} of {data.lessons.length} lessons</span>
          <div className="meter"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </header>

      <div className="section-head"><h2>Lesson ledger</h2><span className="lede">In sequence, always replayable.</span></div>
      <div className="lesson-ledger">
        {data.lessons.map((lesson, index) => {
          const done = data.completedLessonIds.has(lesson.id);
          const current = lesson.id === nextLessonId;
          return (
            <Link
              href={`/learn/${data.module.id}/${lesson.id}`}
              className={`blueprint lesson-ledger-row${done ? " done" : ""}${current ? " current" : ""}`}
              key={lesson.id}
            >
              <span className="lesson-ledger-index">{done ? "✓" : String(index + 1).padStart(2, "0")}</span>
              <span className="lesson-ledger-main">
                <b>{lesson.title}</b>
                <span>{lessonTypeLabel(lesson.type)} · {formatLessonTime(lesson.estimatedSeconds)} · {lesson.content.xp_reward} XP</span>
              </span>
              <span className="pips" aria-label={`Difficulty ${lesson.difficulty ?? 1} of 3`}>
                {[1, 2, 3].map((pip) => <i className={pip <= (lesson.difficulty ?? 1) ? "on" : ""} key={pip} />)}
              </span>
              <span className="lesson-ledger-status">{done ? "Done" : current ? "Next" : "Open"}</span>
              <span className="lesson-ledger-arrow">→</span>
            </Link>
          );
        })}
      </div>
      {data.lessons.length === 0 && <div className="note">This module has no lessons yet.</div>}
    </main>
  );
}
