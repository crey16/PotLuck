import type { Metadata } from "next";
import Link from "next/link";
import { TableScenarioPlayer } from "../../../components/learn/TableScenarioPlayer";
import { fetchTableScenarioServer } from "../../../lib/learn/serverApi";

export const metadata: Metadata = { title: "Table decisions · Learn · PotLuck" };

interface TablePageProps {
  searchParams: Promise<{ module?: string; difficulty?: string; skill?: string }>;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function TablePage({ searchParams }: TablePageProps) {
  const query = await searchParams;
  const filters = {
    moduleId: positiveInt(query.module),
    difficulty: positiveInt(query.difficulty),
    skillTag: query.skill?.slice(0, 64) || undefined,
  };
  const scenario = await fetchTableScenarioServer(filters);

  if (!scenario) {
    return (
      <main className="page-narrow scenario-page">
        <div className="blueprint learn-empty">
          <div className="mono-label accent">Table lab unavailable</div>
          <h1>No table decision could be loaded.</h1>
          <p>The API may still be starting, or the table-scenario seed has not been applied.</p>
          <Link href="/learn/table" className="btn btn-primary blueprint btn-caps">Try again</Link>
        </div>
      </main>
    );
  }

  return <TableScenarioPlayer initialScenario={scenario} filters={filters} />;
}
