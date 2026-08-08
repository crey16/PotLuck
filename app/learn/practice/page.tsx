import type { Metadata } from "next";
import { PracticeLoader } from "../../../components/learn/PracticeLoader";

export const metadata: Metadata = { title: "Practice hand · Learn · PotLuck" };

interface PracticePageProps {
  searchParams: Promise<{
    id?: string;
    module?: string;
    difficulty?: string;
    skill?: string;
    daily?: string;
  }>;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The query string is still parsed and bounded on the server, so the client
 * receives validated numbers rather than raw input. Only the fetch moved — see
 * `components/learn/AsyncResource.tsx`.
 *
 * No `<main>` here: `ScenarioPlayer` renders its own, and the loader matches
 * it for the loading and error states.
 */
export default async function PracticePage({ searchParams }: PracticePageProps) {
  const query = await searchParams;
  const options = {
    id: positiveInt(query.id),
    moduleId: positiveInt(query.module),
    difficulty: positiveInt(query.difficulty),
    skillTag: query.skill?.slice(0, 64) || undefined,
  };
  return <PracticeLoader options={options} daily={query.daily === "1"} />;
}
