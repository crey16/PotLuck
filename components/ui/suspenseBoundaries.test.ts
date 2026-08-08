import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { Suspense, createElement as h, type ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { RecommendedNextFallback } from "../learn/RecommendedNext";
import { LeaderboardPanelFallback } from "../social/LeaderboardPanel";

/**
 * M8.8C: the shell must not wait on the personalized sections.
 *
 * These are BEHAVIOURAL tests of the streaming boundary, not assertions about
 * JSX shape. The claim "the shell renders first" is a claim about time, so it
 * is measured in time: a personalized child is held pending, and the test
 * asserts the shell was already flushed while it was still unresolved. The
 * second test proves the same tree WITHOUT a boundary cannot do that, which is
 * the regression these boundaries exist to prevent — delete a `<Suspense>` in
 * `app/page.tsx` or `app/leaderboard/page.tsx` and that is the behaviour you
 * get back.
 *
 * The fallbacks are the REAL shipped components, so a fallback that stops
 * rendering, or starts throwing, fails here rather than in production.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

interface Rendered {
  /** Markup available at the moment the shell was ready. */
  shell: string;
  /** Whether the personalized child had resolved by then. */
  personalizedResolvedAtShell: boolean;
  full: string;
}

/**
 * Render `tree` to a stream and record what existed when the shell was ready.
 *
 * `onShellReady` is the exact moment Next flushes the first bytes to the
 * browser, so it is the honest measuring point for "what does the user see
 * first".
 */
function renderStreaming(tree: ReactElement, resolved: { value: boolean }): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let shell = "";
    let personalizedResolvedAtShell = false;
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString("utf8"));
        callback();
      },
    });
    sink.on("finish", () => resolve({ shell, personalizedResolvedAtShell, full: chunks.join("") }));
    const stream = renderToPipeableStream(tree, {
      onShellReady() {
        personalizedResolvedAtShell = resolved.value;
        stream.pipe(sink);
        // Everything written synchronously by the pipe IS the shell.
        shell = chunks.join("");
      },
      onError: reject,
    });
  });
}

/** A personalized section that takes its time, like five Supabase queries. */
function slowSection(resolved: { value: boolean }, marker: string) {
  return async function Personalized() {
    await new Promise((r) => setTimeout(r, 40));
    resolved.value = true;
    return h("p", null, marker);
  };
}

test("the dashboard shell flushes while the recommendation is still pending", async () => {
  const resolved = { value: false };
  const Personalized = slowSection(resolved, "RECOMMENDATION");
  const tree = h(
    "main",
    null,
    h("h1", null, "Good evening, Collin."),
    h("section", null, h("h2", null, "The drills")),
    h(
      "div",
      { className: "home-learning" },
      h(
        Suspense,
        { fallback: h(RecommendedNextFallback, null) },
        h(Personalized as never, null),
      ),
      h("a", { href: "/daily" }, "Daily lesson"),
    ),
  );

  const { shell, personalizedResolvedAtShell, full } = await renderStreaming(tree, resolved);

  assert.equal(personalizedResolvedAtShell, false, "the shell must not wait for the section");
  assert.ok(shell.includes("Good evening"), "the hero is in the first flush");
  assert.ok(shell.includes("The drills"), "so is the rest of the page");
  assert.ok(shell.includes("Daily lesson"), "and the boundary's static siblings");
  assert.ok(
    shell.includes("Recommended next"),
    "the real fallback renders in the first flush, holding the card's place",
  );
  assert.ok(!shell.includes("RECOMMENDATION"), "the pending content is not in the shell");
  assert.ok(full.includes("RECOMMENDATION"), "and it does arrive later on the same response");
});

test("without the boundary the whole page waits — the regression this prevents", async () => {
  const resolved = { value: false };
  const Personalized = slowSection(resolved, "RECOMMENDATION");
  const tree = h(
    "main",
    null,
    h("h1", null, "Good evening, Collin."),
    h(Personalized as never, null),
  );

  const { shell, personalizedResolvedAtShell } = await renderStreaming(tree, resolved);

  assert.equal(
    personalizedResolvedAtShell,
    true,
    "with no boundary the shell is withheld until the slow read finishes",
  );
  assert.ok(shell.includes("Good evening"));
  assert.ok(shell.includes("RECOMMENDATION"), "everything arrives at once, which is the problem");
});

test("the leaderboard heading flushes while the board is still pending", async () => {
  const resolved = { value: false };
  const Board = slowSection(resolved, "BOARD-ROWS");
  const tree = h(
    "main",
    null,
    h("div", { className: "section-head" }, h("h1", null, "Ranks")),
    h(Suspense, { fallback: h(LeaderboardPanelFallback, null) }, h(Board as never, null)),
  );

  const { shell, personalizedResolvedAtShell, full } = await renderStreaming(tree, resolved);

  assert.equal(personalizedResolvedAtShell, false);
  assert.ok(shell.includes("Ranks"));
  assert.ok(shell.includes("Counting XP"), "the real fallback holds the board's place");
  assert.ok(!shell.includes("BOARD-ROWS"));
  assert.ok(full.includes("BOARD-ROWS"));
});

test("one pending section does not delay a sibling that is ready", async () => {
  // Two boundaries, one slow and one fast. The fast one must not be dragged
  // onto the slow one's timeline — that is the difference between focused
  // boundaries and one boundary wrapped around everything personalized.
  //
  // The measurement is deliberately NOT "the fast section is in the first
  // flush": an async component always resolves after the synchronous shell,
  // so its content lands in a later chunk however fast it is. What matters is
  // whether it had to WAIT for the slow one, so that is what is recorded — the
  // state of the slow section at the moment the fast one's chunk is written.
  const slowResolved = { value: false };
  const Slow = slowSection(slowResolved, "SLOW-SECTION");
  async function Fast() {
    return h("p", null, "FAST-SECTION");
  }
  const tree = h(
    "main",
    null,
    h(Suspense, { fallback: h("p", null, "slow-pending") }, h(Slow as never, null)),
    h(Suspense, { fallback: h("p", null, "fast-pending") }, h(Fast as never, null)),
  );

  const chunks: string[] = [];
  let slowPendingWhenFastArrived: boolean | null = null;
  await new Promise<void>((resolve, reject) => {
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        const text = chunk.toString("utf8");
        if (slowPendingWhenFastArrived === null && text.includes("FAST-SECTION")) {
          slowPendingWhenFastArrived = !slowResolved.value;
        }
        chunks.push(text);
        callback();
      },
    });
    sink.on("finish", () => resolve());
    const stream = renderToPipeableStream(tree, {
      onShellReady() {
        stream.pipe(sink);
      },
      onError: reject,
    });
  });

  const full = chunks.join("");
  assert.equal(slowPendingWhenFastArrived, true, "the fast section did not wait for the slow one");
  assert.ok(
    full.indexOf("FAST-SECTION") < full.indexOf("SLOW-SECTION"),
    "and it reaches the browser first",
  );
  assert.ok(full.includes("slow-pending"), "the slow section showed its own fallback meanwhile");
});

/**
 * The structural half: the behavioural tests above prove the MECHANISM, and
 * these prove the shipped pages actually use it. Both are needed — a page that
 * awaits its personalized read before returning any JSX would pass every test
 * above while streaming nothing.
 */
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("the dashboard starts the recommendation without awaiting it", () => {
  const source = read("app/page.tsx");
  // Starting it in the page is REQUIRED, so that it runs alongside the stats
  // read rather than after it. Awaiting it in the page is what must not
  // happen, and so is putting it back into a Promise.all with the stats.
  assert.match(source, /const recommendation = fetchServerRecommendation\(\);/);
  assert.ok(
    !/await\s+fetchServerRecommendation/.test(source),
    "the page must not await the recommendation — the boundary does",
  );
  assert.ok(
    !/Promise\.all\(\[[\s\S]*?fetchServerRecommendation/.test(source),
    "and it must not be re-joined to the stats read",
  );
  assert.match(source, /<Suspense fallback=\{<RecommendedNextFallback \/>\}>/);
  assert.match(source, /<RecommendedNext recommendation=\{recommendation\} \/>/);
  // The placement redirect must stay ahead of everything: a redirect decided
  // inside a streamed boundary arrives after the response has begun.
  const redirectAt = source.indexOf('redirect("/placement")');
  const suspenseAt = source.indexOf("<Suspense");
  assert.ok(redirectAt > 0 && redirectAt < suspenseAt, "the placement redirect stays before the stream");
});

test("the leaderboard page renders its heading outside the boundary", () => {
  const source = read("app/leaderboard/page.tsx");
  const headingAt = source.indexOf("Ranks<");
  const suspenseAt = source.indexOf("<Suspense");
  assert.ok(headingAt > 0 && suspenseAt > headingAt, "the heading must precede the boundary");
  assert.ok(
    !/fetchGlobalLeaderboard|fetchFriendIds|fetchProfileById/.test(source),
    "the board's reads belong in LeaderboardPanel, behind the boundary",
  );
});

test("the already-client-loaded surfaces are left alone, deliberately", () => {
  // `/play/history` and the three routes from ddab0e6 fetch in the browser and
  // render their own shell plus a loading state immediately. A Suspense
  // boundary around a client component that does not suspend is decorative
  // markup, and this test exists so that nobody adds one to look thorough.
  for (const route of [
    "app/play/history/page.tsx",
    "app/daily/page.tsx",
    "app/learn/practice/page.tsx",
    "app/learn/table/page.tsx",
  ]) {
    assert.ok(
      !read(route).includes("<Suspense"),
      `${route} loads in the browser already — a boundary there suspends nothing`,
    );
  }
});
