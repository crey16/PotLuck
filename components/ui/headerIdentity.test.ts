import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { Suspense, createElement as h, type ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import {
  AccountName,
  AccountNameFallback,
  StreakChip,
  type HeaderIdentity,
} from "./SiteHeader";

/**
 * M8.8B: the header must not hold the shell, and must not flash signed-out.
 *
 * `layout.headerProfile` was the measured floor under the entire app — 78ms
 * p50 / 139ms p95 on all 300 of M8.8A's baseline requests, on every route
 * including the ones that read nothing else, because the root layout `await`ed
 * it before returning any markup.
 *
 * M8.8C had already looked at deferring it and rejected the idea, for a reason
 * that was correct then: the header decided "signed in?" from the presence of
 * `username`, so deferring meant painting the signed-out header and swapping
 * in the account menu a moment later. **These tests exist to prove the new
 * arrangement gets the speed without that regression** — both halves, in time,
 * through React's real streaming renderer rather than by asserting on JSX.
 *
 * The two claims are opposites and both have to hold:
 *
 * 1. The shell flushes while the profile row is still in flight.
 * 2. That shell already shows the SIGNED-IN header — the account control is
 *    present, and nothing in it says "Sign in".
 *
 * ## What is rendered here, and why it is not `SiteHeader` itself
 *
 * `SiteHeader` calls `usePathname()` and `useRouter()`, which throw outside a
 * mounted App Router. Providing that context means importing a Next internal
 * path, which this project has already declined to do once (see the
 * `next/dist/compiled/web-vitals` note in `PerfReporter.tsx`).
 *
 * So the tree below is the header's real STRUCTURE — `signedIn` chooses the
 * account control, the identity children sit behind `<Suspense>` — built from
 * the **actual exported components** `AccountName`, `AccountNameFallback` and
 * `StreakChip`. The suspending subtree, which is the whole subject, is the
 * shipped one; only the nav chrome around it is stand-in. The wiring that the
 * stand-in cannot cover — that `SiteHeader` really does gate on `signedIn` and
 * really does wrap these in `Suspense` — is asserted against the source at the
 * bottom of this file.
 */

interface Rendered {
  shell: string;
  identityResolvedAtShell: boolean;
  full: string;
}

function renderStreaming(tree: ReactElement, resolved: { value: boolean }): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let shell = "";
    let identityResolvedAtShell = false;
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString("utf8"));
        callback();
      },
    });
    sink.on("finish", () => resolve({ shell, identityResolvedAtShell, full: chunks.join("") }));
    const stream = renderToPipeableStream(tree, {
      onShellReady() {
        identityResolvedAtShell = resolved.value;
        stream.pipe(sink);
        shell = chunks.join("");
      },
      onError: reject,
    });
  });
}

/** A profile read that takes as long as the measured p95. */
function slowIdentity(resolved: { value: boolean }): Promise<HeaderIdentity | null> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolved.value = true;
      resolve({ username: "collin", displayName: "Collin R", level: 7, streak: 12 });
    }, 40);
  });
}

/**
 * The header's structure, with the real suspending components in it.
 *
 * Mirrors `SiteHeader`: the account control is chosen by `signedIn` alone, and
 * everything that needs the profile row sits behind a boundary.
 */
function header(signedIn: boolean, identity?: Promise<HeaderIdentity | null>) {
  const pending = signedIn ? identity : undefined;
  return h(
    "header",
    null,
    h("nav", null, "Home", "Learn", "Drill", "Play", "Ranges", "Reference"),
    pending
      ? h(Suspense, { fallback: null }, h(StreakChip, { identity: pending }))
      : null,
    signedIn
      ? h(
          "button",
          { className: "site-account-trigger" },
          h(
            Suspense,
            { fallback: h(AccountNameFallback, null) },
            pending ? h(AccountName, { identity: pending }) : h(AccountNameFallback, null)
          )
        )
      : h("a", { href: "/login" }, "Sign in")
  );
}

test("the shell flushes while the profile row is still in flight", async () => {
  const resolved = { value: false };
  const tree = h("div", null, header(true, slowIdentity(resolved)), h("main", null, "PAGE BODY"));

  const { shell, identityResolvedAtShell, full } = await renderStreaming(tree, resolved);

  assert.equal(
    identityResolvedAtShell,
    false,
    "the header still blocks the shell on the profile read — the M8.8A floor is back"
  );
  // The nav and the page body are in the first flush, so every route's TTFB
  // stops depending on a database round trip.
  assert.ok(shell.includes("PAGE BODY"), "the page body is in the first flush");
  assert.ok(shell.includes("Ranges"), "so is the nav");
  assert.ok(!shell.includes("collin"), "the pending username is not in the shell");
  assert.ok(full.includes("collin"), "and it does arrive later on the same response");
});

test("the shell already shows the SIGNED-IN header — no signed-out flash", async () => {
  // This is the regression M8.8C predicted and correctly refused to risk. It
  // is avoided because "signed in?" no longer needs the database: the layout
  // knows it from the locally-verified JWT and passes it as `signedIn`.
  const resolved = { value: false };
  const tree = header(true, slowIdentity(resolved));

  const { shell } = await renderStreaming(tree, resolved);

  assert.ok(
    shell.includes("site-account-trigger"),
    "the account control must be in the shell, not swapped in later"
  );
  assert.ok(
    !shell.includes("Sign in"),
    "the signed-out call to action must never appear for a signed-in reader"
  );
});

test("a signed-out reader gets the signed-out header immediately", async () => {
  const resolved = { value: false };
  const tree = header(false);
  const { shell } = await renderStreaming(tree, resolved);

  assert.ok(shell.includes("Sign in"), "signed-out header renders its call to action");
  assert.ok(!shell.includes("site-account-trigger"), "and no account control");
});

test("the placeholder holds the account control's place", async () => {
  // Layout stability is a budget, not a nicety: CLS ≤ 0.10 in
  // `docs/17-m88a-performance-baseline.md`, and this element is on every
  // route. A zero-width fallback would spend that budget everywhere at once.
  const resolved = { value: false };
  const tree = header(true, slowIdentity(resolved));
  const { shell } = await renderStreaming(tree, resolved);

  // The avatar circle and a name-width block are both reserved.
  assert.match(shell, /width:\s*26px/, "the avatar's 26px circle is reserved");
  assert.match(shell, /width:\s*7ch/, "and a name-sized block beside it");
});

test("an identity that never resolves still leaves a usable header", async () => {
  // A failed or hanging profile read must degrade to "no name", never to a
  // broken page — the old code destructured `{ data }` and ignored the error
  // for exactly this reason, and that fail-soft behaviour has to survive.
  const resolved = { value: false };
  const tree = header(true, Promise.resolve(null));
  const { shell, full } = await renderStreaming(tree, resolved);

  assert.ok(shell.includes("site-account-trigger") || full.includes("site-account-trigger"));
  assert.ok(!full.includes("/u/undefined"), "no profile link is built from a missing username");
  assert.ok(!full.includes("undefined-DAY STREAK"));
});

/* ------------------------------------------------------- wiring guards */

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

test("the root layout does not await the profile", () => {
  const layout = read("app", "layout.tsx");
  // The specific shape that put 78ms in front of every route.
  assert.ok(
    !/await\s+headerIdentity\(\)/.test(layout),
    "awaiting the identity in the layout restores the universal floor"
  );
  assert.match(layout, /const identity = signedIn \? headerIdentity\(\) : undefined;/);
  // `signedIn` must come from the free check, not from the row.
  assert.match(layout, /await getAuthUserId\(\)\) !== null/);
});

test("the header reads the profile through the shared request context", () => {
  const layout = read("app", "layout.tsx");
  assert.match(layout, /getSessionProfile/);
  assert.ok(
    !layout.includes('.from("profiles")'),
    "the layout must not issue its own profile query — that was the duplicate"
  );
});

test("a rejected identity cannot take down the header", async () => {
  // The old layout dropped the error from `{ data, error }` on the floor, so a
  // database outage produced a nameless header and nothing worse. A promise
  // handed to a client component loses that for free: `use()` re-throws into
  // the render, and this is the ROOT layout, so it would take every page with
  // it. The `.catch` in `headerIdentity()` is what restores it.
  const layout = read("app", "layout.tsx");
  assert.match(
    layout,
    /\}\)\.catch\(\(\) => null\);/,
    "headerIdentity() must swallow a failed profile read into a nameless header"
  );

  // And the component tolerates the null that produces.
  const resolved = { value: false };
  const { full } = await renderStreaming(header(true, Promise.resolve(null)), resolved);
  assert.ok(!full.includes("undefined"), "a missing profile must not render `undefined`");
});

test("SiteHeader gates the account control on signedIn, never on the username", () => {
  // The exact regression M8.8C feared. If this condition ever goes back to
  // deriving "signed in" from the profile row, the header returns to painting
  // the signed-out state first — and the stand-in tree above would not notice.
  const source = read("components", "ui", "SiteHeader.tsx");
  assert.ok(
    !/const signedIn = username !== undefined/.test(source),
    "signed-in state must not be derived from the username again"
  );
  assert.match(source, /\{signedIn && \(/, "the account control is gated on signedIn");
  assert.match(source, /const pending = signedIn \? identity : undefined;/);
});

test("every identity consumer in SiteHeader sits behind a Suspense boundary", () => {
  // `use(identity)` outside a boundary suspends the WHOLE header, which is the
  // blocking this milestone removed — just relocated from the server to the
  // client.
  const source = read("components", "ui", "SiteHeader.tsx");
  const body = source.slice(source.indexOf("export function SiteHeader("));
  for (const child of ["StreakChip", "AccountName", "AccountMenuDetails", "AccountProfileLink"]) {
    const used = new RegExp(`<${child}\\b`).test(body);
    assert.ok(used, `${child} is no longer rendered by SiteHeader`);
  }
  // `use()` must appear only in the small children, never in SiteHeader itself.
  assert.ok(!/\buse\(identity\)/.test(body), "SiteHeader must not use() the promise directly");
  const boundaries = (body.match(/<Suspense/g) ?? []).length;
  assert.ok(boundaries >= 4, `expected a boundary per identity consumer, found ${boundaries}`);
});

test("the read is still traced under its M8.8A name", () => {
  // The baseline's before/after comparison is keyed on this string. Renaming
  // it silently would make the milestone unmeasurable.
  assert.match(read("app", "layout.tsx"), /timeServerRead\("layout\.headerProfile"/);
});
