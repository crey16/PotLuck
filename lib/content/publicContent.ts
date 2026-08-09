import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContentClient } from "../supabase/contentClient";
import { createClient } from "../supabase/server";
import { lessonFromRow } from "../learn/content";
import type { LearningModule, Lesson } from "../learn/types";
import {
  PUBLIC_CONTENT_MAX_AGE_SECONDS,
  PUBLIC_CONTENT_TAG,
  publicContentKeyParts,
} from "./version";

/**
 * The shipped course, read once and shared — M8.8C.
 *
 * ## The boundary this file exists to draw
 *
 * Before this, `lib/learn/server.ts` had four functions that each fetched
 * product content and user progress in the same `Promise.all`. That is a
 * reasonable way to write one page and a bad way to cache anything: the
 * content half is identical for every account and changes when the course
 * ships, the progress half is different for every account and changes when
 * they answer a question. Blended, the only safe policy is the stricter of the
 * two, so nothing could be cached at all.
 *
 * Everything in this module is the first half. **No function here takes a user
 * id, reads a cookie, or selects from a user-scoped table**, and
 * `publicContent.test.ts` enforces all three by inspecting this source. The
 * personalized half stays in `lib/learn/server.ts`, is read fresh on every
 * request, and is composed with this on top.
 *
 * ## Why the payload is plain JSON
 *
 * `PublicContent` holds arrays and plain objects, never a `Set` or a `Map`.
 * The Data Cache serializes what it stores, so a `Set` would come back as
 * `{}` — silently empty, with no error. `LearningPathData.completedLessonIds`
 * is a `Set` and is deliberately built on the personalized side of the
 * boundary, after the cached value has been read.
 *
 * ## Two layers, doing different jobs
 *
 * `unstable_cache` is the cross-request layer: Vercel's Data Cache, shared by
 * every instance of a deployment, keyed by `publicContentKeyParts()`. React's
 * `cache()` wraps it as the per-request layer, so a single render that needs
 * the course twice — `/learn` renders the path and the recommendation — pays
 * for one lookup rather than two. The second layer matters most when the first
 * is unavailable: with no service-role key there is no shared cache, and
 * request-level de-duplication is the whole benefit.
 */

export interface PublicScenario {
  id: number;
  moduleId: number;
  skillTag: string;
  difficulty: number;
}

export interface PublicContent {
  modules: LearningModule[];
  lessons: Lesson[];
  scenarios: PublicScenario[];
}


function moduleFromRow(row: Record<string, unknown>): LearningModule | null {
  if (
    typeof row.id !== "number" ||
    typeof row.title !== "string" ||
    typeof row.description !== "string" ||
    typeof row.order_index !== "number"
  ) {
    return null;
  }
  return { id: row.id, title: row.title, description: row.description, order: row.order_index };
}

function scenarioFromRow(row: Record<string, unknown>): PublicScenario | null {
  if (
    typeof row.id !== "number" ||
    typeof row.module_id !== "number" ||
    typeof row.skill_tag !== "string" ||
    typeof row.difficulty !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    moduleId: row.module_id,
    skillTag: row.skill_tag,
    difficulty: row.difficulty,
  };
}

const LESSON_COLUMNS =
  "id, module_id, lesson_type, title, order_index, content_json, estimated_time_seconds, difficulty, version";

/**
 * The one query set, run against whichever client the caller could build.
 *
 * Ordering is applied here rather than by consumers so that the cached value
 * is already in its canonical shape — two callers must not be able to observe
 * the course in two different orders depending on who populated the entry.
 *
 * Throws on a database error instead of returning empty. That distinction is
 * the whole reason this is not `?? []`: an empty course and a failed read look
 * identical downstream, and caching the failure would pin "the course is
 * empty" in the Data Cache for an hour. A rejected promise is not stored.
 */
export async function readPublicContent(supabase: SupabaseClient): Promise<PublicContent> {
  const [modulesResult, lessonsResult, scenariosResult] = await Promise.all([
    supabase
      .from("modules")
      .select("id, title, description, order_index")
      .eq("is_active", true)
      .order("order_index"),
    supabase
      .from("lessons")
      .select(LESSON_COLUMNS)
      .eq("is_active", true)
      .order("module_id")
      .order("order_index"),
    supabase
      .from("scenarios")
      .select("id, module_id, skill_tag, difficulty")
      .eq("is_active", true)
      .order("id"),
  ]);
  const error = modulesResult.error ?? lessonsResult.error ?? scenariosResult.error;
  if (error) throw new Error(`public content read failed: ${error.message}`);
  return {
    modules: (modulesResult.data ?? []).flatMap((row) => {
      const parsed = moduleFromRow(row);
      return parsed ? [parsed] : [];
    }),
    lessons: (lessonsResult.data ?? []).flatMap((row) => {
      const parsed = lessonFromRow(row);
      return parsed ? [parsed] : [];
    }),
    scenarios: (scenariosResult.data ?? []).flatMap((row) => {
      const parsed = scenarioFromRow(row);
      return parsed ? [parsed] : [];
    }),
  };
}

/**
 * The cross-request entry.
 *
 * The key parts are passed as an ARGUMENT as well as being baked into the key
 * array. `unstable_cache` includes a cached function's arguments in its key,
 * so this is what actually makes a version bump reach a different entry — the
 * static array alone is fixed at module load. Dropping the parameter would
 * produce a cache that looks versioned and is not, which is the specific bug
 * `publicContent.test.ts` mutation-tests for.
 */
const loadCached = unstable_cache(
  // Unused in the body ON PURPOSE, and load-bearing: `unstable_cache` folds a
  // cached function's arguments into its key, so this parameter is the only
  // reason a version bump reaches a different entry. Deleting it as dead code
  // would leave a cache that looks versioned and never invalidates.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (_keyParts: string[]): Promise<PublicContent> => {
    const supabase = createContentClient();
    // Re-checked rather than assumed: `contentCacheAvailable()` gates the call
    // site, but a cached function that silently read nothing would poison the
    // entry, so this refuses instead.
    if (!supabase) throw new Error("public content cache invoked with no content client");
    return readPublicContent(supabase);
  },
  ["public-content"],
  { tags: [PUBLIC_CONTENT_TAG], revalidate: PUBLIC_CONTENT_MAX_AGE_SECONDS }
);

/**
 * The shipped course — cached across requests when the deployment can, and
 * always de-duplicated within one render.
 *
 * Falls back to the request's own authenticated client on any failure of the
 * shared path, including the service-role key being absent. The fallback reads
 * exactly the same rows through RLS, so the result is identical; only the
 * sharing is lost.
 *
 * **Throws when both readers fail, and that is deliberate.** An empty course
 * and an unreachable database look the same downstream, and `/learn` renders
 * the empty one as "the learning tables are ready, but empty — apply
 * seed.sql", which is a confidently wrong thing to tell someone during an
 * outage. Callers in `lib/learn/server.ts` catch this and produce the same
 * error each of them produced before the split.
 */
export const loadPublicContent = cache(
  async (): Promise<PublicContent> =>
    resolvePublicContent({
      cached: createContentClient() ? () => loadCached(publicContentKeyParts()) : null,
      direct: async () => readPublicContent(await createClient()),
    })
);

/**
 * Which reader wins, and what happens when one fails.
 *
 * Split out from `loadPublicContent` so the policy can be executed in a unit
 * test without a Next request scope or a database — the wiring above is what
 * needs a running app, this is what needs to be provably right.
 *
 * `cached` is null when the deployment has no service-role key. A cached read
 * that throws is not fatal: `unstable_cache` stores nothing for a rejected
 * promise, so the direct read both answers this request and leaves the entry
 * free to populate correctly on the next one. A failure of BOTH paths
 * propagates — see the note above on why an outage must not be reported as an
 * empty course.
 */
export async function resolvePublicContent(readers: {
  cached: (() => Promise<PublicContent>) | null;
  direct: () => Promise<PublicContent>;
}): Promise<PublicContent> {
  if (readers.cached) {
    try {
      return await readers.cached();
    } catch {
      // Fall through — the direct read is about to attempt the same query.
    }
  }
  return readers.direct();
}

/** Lessons of one module, in order — a view over the cached course. */
export const lessonsForModule = (content: PublicContent, moduleId: number): Lesson[] =>
  content.lessons.filter((lesson) => lesson.moduleId === moduleId);

/** One module, or null when it is absent or inactive. */
export const moduleById = (content: PublicContent, moduleId: number): LearningModule | null =>
  content.modules.find((entry) => entry.id === moduleId) ?? null;

/** One lesson, only when it really belongs to that module. */
export const lessonById = (
  content: PublicContent,
  moduleId: number,
  lessonId: number
): Lesson | null =>
  content.lessons.find((lesson) => lesson.id === lessonId && lesson.moduleId === moduleId) ?? null;
