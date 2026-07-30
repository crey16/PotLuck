import type { Metadata } from "next";
import Link from "next/link";
import { ScenarioPlayer } from "../../../components/learn/ScenarioPlayer";
import { fetchScenarioServer } from "../../../lib/learn/serverApi";

export const metadata: Metadata = { title: "Practice hand · Learn · PotLuck" };

interface PracticePageProps {
  searchParams: Promise<{ id?: string; module?: string; difficulty?: string; skill?: string; daily?: string }>;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function PracticePage({ searchParams }: PracticePageProps) {
  const query = await searchParams;
  const options = {
    id: positiveInt(query.id),
    moduleId: positiveInt(query.module),
    difficulty: positiveInt(query.difficulty),
    skillTag: query.skill?.slice(0, 64) || undefined,
  };
  const scenario = await fetchScenarioServer(options);
  if (!scenario) {
    return (
      <main className="page-narrow scenario-page">
        <div className="blueprint learn-empty">
          <div className="mono-label accent">Practice unavailable</div>
          <h1>No authored hand could be loaded.</h1>
          <p>The API may still be starting, or the scenario seed has not been applied.</p>
          <Link href="/learn/practice" className="btn btn-primary blueprint btn-caps">Try again</Link>
        </div>
      </main>
    );
  }
  return (
    <ScenarioPlayer
      initialScenario={scenario}
      filters={{ moduleId: options.moduleId, difficulty: options.difficulty, skillTag: options.skillTag }}
      daily={query.daily === "1"}
    />
  );
}
