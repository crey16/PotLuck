import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { createClient } from "@/lib/supabase/server";
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
  description: "Poker math trainer — drills, range charts, and the formulas behind them.",
};

async function fetchHeaderProfile() {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, level, streak_count")
    .eq("id", user.id)
    .single();
  return profile;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const profile = await fetchHeaderProfile();

  return (
    <html lang="en" data-theme={theme} className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <SiteHeader
          username={profile?.username}
          displayName={profile?.display_name ?? undefined}
          level={profile?.level}
          streak={profile?.streak_count}
        />
        {children}
      </body>
    </html>
  );
}
