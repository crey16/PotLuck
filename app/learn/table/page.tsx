import type { Metadata } from "next";
import { TableLoader } from "../../../components/learn/TableLoader";

export const metadata: Metadata = { title: "Table decisions · Learn · PotLuck" };

interface TablePageProps {
  searchParams: Promise<{ module?: string; difficulty?: string; skill?: string }>;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The query string is still parsed and bounded on the server; only the fetch
 * moved to the browser — see `components/learn/AsyncResource.tsx`.
 *
 * No `<main>` here: `TableScenarioPlayer` renders its own.
 */
export default async function TablePage({ searchParams }: TablePageProps) {
  const query = await searchParams;
  const filters = {
    moduleId: positiveInt(query.module),
    difficulty: positiveInt(query.difficulty),
    skillTag: query.skill?.slice(0, 64) || undefined,
  };
  return <TableLoader filters={filters} />;
}
