"use client";

import { getDaily } from "../../lib/learn/api";
import { ResourceLoading, ResourceUnavailable, useResource } from "./AsyncResource";
import { DailyCard } from "./DailyCard";

/** Loads `/api/daily` in the browser and renders it. See `AsyncResource`. */
export function DailyLoader() {
  const { resource, reload } = useResource(() => getDaily());

  if (resource.status === "loading") return <ResourceLoading label="Fetching today’s item…" />;
  if (resource.status === "error") {
    return (
      <ResourceUnavailable error={resource.error} subject="today’s lesson" onRetry={reload} />
    );
  }
  return <DailyCard daily={resource.value} />;
}
