"use client";

import { getScenario } from "../../lib/learn/api";
import { ResourceLoading, ResourceUnavailable, useResource } from "./AsyncResource";
import { ScenarioPlayer } from "./ScenarioPlayer";

export interface PracticeLoaderProps {
  /** Serializable, because these cross the server/client boundary as props. */
  options: { id?: number; moduleId?: number; difficulty?: number; skillTag?: string };
  daily: boolean;
}

/**
 * Loads the first authored scenario in the browser, then hands over to
 * `ScenarioPlayer` — which already fetches every SUBSEQUENT hand the same way
 * through `getScenario`, so this only removes the special case the first one
 * used to be.
 */
export function PracticeLoader({ options, daily }: PracticeLoaderProps) {
  const { resource, reload } = useResource(() => getScenario(options));

  // `ScenarioPlayer` renders its own `<main className="page-narrow
  // scenario-page">`, so the placeholder wears the same one — otherwise the
  // page changes width the moment the hand lands.
  if (resource.status !== "ready") {
    return (
      <main className="page-narrow scenario-page">
        {resource.status === "loading" ? (
          <ResourceLoading label="Dealing a practice hand…" />
        ) : (
          <ResourceUnavailable error={resource.error} subject="authored hand" onRetry={reload} />
        )}
      </main>
    );
  }
  return (
    <ScenarioPlayer
      initialScenario={resource.value}
      filters={{
        moduleId: options.moduleId,
        difficulty: options.difficulty,
        skillTag: options.skillTag,
      }}
      daily={daily}
    />
  );
}
