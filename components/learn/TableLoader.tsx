"use client";

import { getTableScenario } from "../../lib/learn/api";
import { ResourceLoading, ResourceUnavailable, useResource } from "./AsyncResource";
import { TableScenarioPlayer } from "./TableScenarioPlayer";

export interface TableLoaderProps {
  /** Serializable, because these cross the server/client boundary as props. */
  filters: { moduleId?: number; difficulty?: number; skillTag?: string };
}

/**
 * Loads the first table decision in the browser, then hands over to
 * `TableScenarioPlayer`, which fetches every later spot through the same
 * `getTableScenario`.
 */
export function TableLoader({ filters }: TableLoaderProps) {
  const { resource, reload } = useResource(() => getTableScenario(filters));

  // Matching `TableScenarioPlayer`'s own container, so the page does not
  // resize under the player when the spot arrives.
  if (resource.status !== "ready") {
    return (
      <main className="page-narrow scenario-page table-scenario-page">
        {resource.status === "loading" ? (
          <ResourceLoading label="Setting the table…" />
        ) : (
          <ResourceUnavailable error={resource.error} subject="table decision" onRetry={reload} />
        )}
      </main>
    );
  }
  return <TableScenarioPlayer initialScenario={resource.value} filters={filters} />;
}
