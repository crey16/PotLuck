"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { unavailableCopy } from "../../lib/learn/loadError";

/**
 * Loading one personalized item in the browser, with the states that implies.
 *
 * WHY THE BROWSER AND NOT THE SERVER. `/daily`, `/learn/practice` and
 * `/learn/table` used to await their content during the server render by
 * calling this deployment's own public `/api` URL — Next function → HTTPS →
 * Python function, with a cold start (300-800ms) sitting in front of first
 * paint and an access token forwarded by hand. The roadmap's rule (M8.8C) is
 * to call a shared server service directly OR load from the browser, and
 * direct is not available here: those endpoints run the weakest-skill
 * recommendation and the daily-content selection in Python, so a TypeScript
 * copy would be a second implementation of the logic M8.8B exists to keep
 * singular. So the shell renders on the server and the personalized item
 * arrives in the browser, through the same `lib/learn/api.ts` the players
 * already use for their "next hand" button.
 */
export type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: unknown };

export interface ResourceHandle<T> {
  resource: Resource<T>;
  reload: () => void;
}

/**
 * Run `load` on mount, and again on `reload()`.
 *
 * `load` is held in a ref rather than named as a dependency. Callers pass an
 * inline arrow — `useResource(() => getDaily())` — whose identity changes
 * every render, and a dependency on that is an infinite request loop that
 * looks like a working page until you watch the network tab.
 *
 * The only state written from inside the effect is written asynchronously,
 * after the request settles. The "loading" transition happens in `reload`,
 * which is an event handler; that keeps this in line with the project's rule
 * against setting state synchronously inside an effect.
 */
export function useResource<T>(load: () => Promise<T>): ResourceHandle<T> {
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });
  const loadRef = useRef(load);

  // Written in an effect, not during render: a ref is mutable state, and
  // touching it while rendering is exactly what the lint rule forbids. This
  // effect has no dependency array on purpose — it re-points the ref after
  // every render, so the fetch below always calls the current closure.
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current()
      .then((value) => {
        if (!cancelled) setResource({ status: "ready", value });
      })
      .catch((error: unknown) => {
        if (!cancelled) setResource({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setResource({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { resource, reload };
}

/**
 * The placeholder shown while the item is in flight.
 *
 * It keeps the page's own container so the shell does not jump when the
 * content lands, and it is announced politely rather than silently swapped.
 */
export function ResourceLoading({ label }: { label: string }) {
  return (
    <div className="blueprint learn-empty" aria-live="polite" aria-busy="true">
      <div className="mono-label accent">Loading</div>
      <p>{label}</p>
    </div>
  );
}

/**
 * The failure panel, saying which failure it was.
 *
 * `onRetry` re-runs the request in place. The old server-rendered version
 * offered a link back to the same route, which only worked because a fresh
 * navigation re-ran the server fetch.
 */
export function ResourceUnavailable({
  error,
  subject,
  onRetry,
}: {
  error: unknown;
  subject: string;
  onRetry: () => void;
}) {
  const copy = unavailableCopy(error, subject);
  return (
    <div className="blueprint learn-empty" role="alert">
      <div className="mono-label accent">Unavailable</div>
      <h1>{copy.title}</h1>
      <p>{copy.detail}</p>
      {copy.action === "signin" ? (
        <Link href="/login" className="btn btn-primary blueprint btn-caps">
          Sign in
        </Link>
      ) : (
        <button type="button" onClick={onRetry} className="btn btn-primary blueprint btn-caps">
          Try again
        </button>
      )}
    </div>
  );
}
