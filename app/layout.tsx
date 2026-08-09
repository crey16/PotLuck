import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { PerfReporter } from "@/components/perf/PerfReporter";
import { REQUEST_ID_HEADER } from "@/lib/observability/requestId";
import { timeServerRead } from "@/lib/observability/serverTiming";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { SiteHeader, type HeaderIdentity } from "@/components/ui/SiteHeader";
import { getAuthUserId } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/supabase/requestContext";
import { supabaseConfigured } from "@/lib/supabase/env";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

const barlow = Barlow({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PotLuck",
  description: "Learn poker decisions, drill the math, and explore practical reference ranges.",
};

/**
 * The header's identity — started here, awaited by nobody on this path.
 *
 * **This was the measured floor under the whole app.** M8.8A timed it at 78ms
 * p50 / 139ms p95 across all 300 baseline requests, and because the root layout
 * `await`ed it, no route could flush its shell sooner — `/reference` and
 * `/system` do no reads of their own and still paid ~92ms TTFB for it.
 *
 * M8.8C considered deferring this and rejected it, correctly at the time: the
 * header decided "signed in?" from the presence of `username`, so deferring
 * meant painting the signed-out header and swapping in the account menu. What
 * changed is not the appetite for risk, it is the shape of the data.
 * `getAuthUserId()` verifies the JWT locally against a cached JWKS — no round
 * trip — so **whether** someone is signed in is free, and only **who** they are
 * costs a query. The header now commits to the signed-in layout from the free
 * fact and streams the name, level and streak into it.
 *
 * The read itself is `getSessionProfile()` from the shared request context, so
 * on `/` this is the same round trip the dashboard uses rather than a second
 * one against the same row.
 */
function headerIdentity(): Promise<HeaderIdentity | null> {
  return timeServerRead("layout.headerProfile", async () => {
    const profile = await getSessionProfile();
    if (!profile) return null;
    return {
      username: profile.username,
      displayName: profile.display_name ?? undefined,
      level: profile.level,
      streak: profile.streak_count,
    };
  }).catch(() => null);
  // The `.catch` is load-bearing, and it is new with the promise.
  //
  // The old code read `const { data } = await supabase…` and dropped the error
  // on the floor, so an unreachable database produced a signed-out-looking
  // header and nothing worse. A promise handed to a client component does not
  // have that luxury: `use()` re-throws a rejection into the render, so the
  // same outage would take out the header — and, because this is the root
  // layout, every page under it. `timeServerRead` rethrows by design so the
  // failure is still logged with its duration; this restores the fail-soft
  // behaviour on the other side of it.
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  // Minted by middleware and forwarded on the request headers (M8.8A). Handed
  // to the browser here because this is the only place that sees both the
  // request and the client tree — it is what lets a page's API calls be
  // recognised as part of that page's load rather than as six unrelated ones.
  const requestId = (await headers()).get(REQUEST_ID_HEADER);

  // Awaited: local JWT verification, no round trip. This is what lets the
  // header pick its signed-in layout without waiting for the profile row.
  const signedIn = supabaseConfigured() && (await getAuthUserId()) !== null;
  // NOT awaited. Started here so the read is already in flight while the page
  // renders, and handed to the header as a promise so the shell can flush.
  const identity = signedIn ? headerIdentity() : undefined;

  return (
    <html lang="en" data-theme={theme} className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <div className="ambient-wash" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <SiteHeader signedIn={signedIn} identity={identity} />
        {children}
        <PerfReporter requestId={requestId} />
      </body>
    </html>
  );
}
