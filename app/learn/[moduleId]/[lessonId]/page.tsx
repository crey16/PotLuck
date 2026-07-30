import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LessonPlayer } from "../../../../components/learn/LessonPlayer";
import { fetchLesson } from "../../../../lib/learn/server";

interface LessonPageProps {
  params: Promise<{ moduleId: string; lessonId: string }>;
  searchParams: Promise<{ daily?: string }>;
}

export async function generateMetadata({ params }: LessonPageProps): Promise<Metadata> {
  const values = await params;
  const moduleId = Number(values.moduleId);
  const lessonId = Number(values.lessonId);
  const data = Number.isInteger(moduleId) && Number.isInteger(lessonId)
    ? await fetchLesson(moduleId, lessonId)
    : null;
  return { title: data ? `${data.lesson.title} · PotLuck` : "Lesson · PotLuck" };
}

export default async function LessonPage({ params, searchParams }: LessonPageProps) {
  const [values, query] = await Promise.all([params, searchParams]);
  const moduleId = Number(values.moduleId);
  const lessonId = Number(values.lessonId);
  if (!Number.isInteger(moduleId) || !Number.isInteger(lessonId)) notFound();
  const data = await fetchLesson(moduleId, lessonId);
  if (!data) notFound();
  return (
    <LessonPlayer
      module={data.module}
      lesson={data.lesson}
      initiallyCompleted={data.completed}
      daily={query.daily === "1"}
    />
  );
}
