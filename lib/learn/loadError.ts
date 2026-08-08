/**
 * What to tell a player when a personalized learning read fails.
 *
 * These three routes (`/daily`, `/learn/practice`, `/learn/table`) used to be
 * server-rendered through the deployment's own public `/api` URL, and that
 * path swallowed every failure into `null` — a 401, a missing seed and a cold
 * Python function all produced the same "the API may still be starting"
 * panel. It was the same sentence whether the fix was to sign in again, to
 * seed the database, or to wait two seconds.
 *
 * The client API already carries the distinction: `LearningApiError` has the
 * HTTP status and the server's own `detail`. This turns that into copy.
 *
 * Structural typing on purpose — taking `LearningApiError` itself would make
 * this module import `lib/learn/api.ts`, which is `"use client"`, and
 * `components/drill/clientBoundary.test.ts` exists to keep server modules from
 * doing exactly that.
 */

export interface UnavailableCopy {
  /** Heading, stating what went wrong rather than what page you are on. */
  title: string;
  /** One sentence on what to do about it. */
  detail: string;
  /** `retry` re-runs the request; `signin` sends them to log in again. */
  action: "retry" | "signin";
}

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

const messageOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
};

/**
 * @param subject what could not be loaded, lower case: "today's lesson".
 */
export function unavailableCopy(error: unknown, subject: string): UnavailableCopy {
  const status = statusOf(error);

  if (status === 401 || status === 403) {
    return {
      title: "Your session has expired.",
      detail: "Sign in again to pick up where you left off.",
      action: "signin",
    };
  }

  if (status === 404) {
    // The request worked and the answer was "there is nothing to give you" —
    // an empty state, not a failure, and retrying will not change it until
    // content is seeded or the filters are loosened.
    return {
      title: `No ${subject} matched.`,
      detail:
        messageOf(error) ??
        "Nothing is available for these filters yet. Try again without them.",
      action: "retry",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      title: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be loaded.`,
      detail: messageOf(error) ?? "The server had a problem. Try again in a moment.",
      action: "retry",
    };
  }

  // No status at all means the request never got an answer: offline, a DNS
  // failure, or the function still cold-starting.
  return {
    title: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be loaded.`,
    detail:
      status === undefined
        ? "The connection failed. Check your network and try again."
        : (messageOf(error) ?? "Try again."),
    action: "retry",
  };
}
