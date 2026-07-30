import { createClient } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import type { AuthoredScenario, DailyContent, TableScenario } from "./types";

function apiOrigin(): string {
  const vercelHost = process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;
  return `http://127.0.0.1:${process.env.API_PORT ?? "8000"}`;
}

async function serverAuthRequest<T>(path: string): Promise<T | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function fetchDailyServer(): Promise<DailyContent | null> {
  return serverAuthRequest("/api/daily");
}

export function fetchScenarioServer(options: {
  id?: number;
  moduleId?: number;
  difficulty?: number;
  skillTag?: string;
}): Promise<AuthoredScenario | null> {
  const params = new URLSearchParams();
  if (options.id) params.set("scenario_id", String(options.id));
  if (options.moduleId) params.set("module_id", String(options.moduleId));
  if (options.difficulty) params.set("difficulty", String(options.difficulty));
  if (options.skillTag) params.set("skill_tag", options.skillTag);
  return serverAuthRequest(`/api/scenarios/random${params.size ? `?${params}` : ""}`);
}

export function fetchTableScenarioServer(options: {
  moduleId?: number;
  difficulty?: number;
  skillTag?: string;
}): Promise<TableScenario | null> {
  const params = new URLSearchParams();
  if (options.moduleId) params.set("module_id", String(options.moduleId));
  if (options.difficulty) params.set("difficulty", String(options.difficulty));
  if (options.skillTag) params.set("skill_tag", options.skillTag);
  return serverAuthRequest(
    `/api/table-scenarios/random${params.size ? `?${params}` : ""}`
  );
}
