import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { PerfReporter } from "@/components/perf/PerfReporter";
import { REQUEST_ID_HEADER } from "@/lib/observability/requestId";
import { timeServerRead } from "@/lib/observability/serverTiming";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { createClient, getAuthUserId } from "@/lib/supabase/server";
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
 * Timed as `layout.headerProfile` (M8.8A) because it is on the critical path of
 * EVERY route, including the ones that otherwise do no work at all. If a page
 * is slow and its own reads are fast, this is the next place to look.
 */
async function fetchHeaderProfile() {
  if (!supabaseConfigured()) return null;
  const userId = await getAuthUserId();
  if (!userId) return null;
  return timeServerRead("layout.headerProfile", async () => {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name, level, streak_count")
      .eq("id", userId)
      .single();
    return profile;
  });
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
  const profile = await fetchHeaderProfile();

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
        <SiteHeader
          username={profile?.username}
          displayName={profile?.display_name ?? undefined}
          level={profile?.level}
          streak={profile?.streak_count}
        />
        {children}
        <PerfReporter requestId={requestId} />
      </body>
    </html>
  );
}
