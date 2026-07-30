import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DrillShell } from "@/components/drill/DrillShell";
import { TAB_ORDER, type TabId } from "@/lib/drill/registry";
import { OPP_MODE_COOKIE, parseOppMode } from "@/lib/drill/oppMode";
import { fetchKindStats } from "@/lib/drill/serverStats";

export default async function DrillPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  // Reference is a page of its own in the redesign; the old tab URL still works.
  if (tab === "reference") redirect("/reference");
  const initialTab: TabId =
    tab && (TAB_ORDER as string[]).includes(tab) ? (tab as TabId) : "mixed";

  const kindStats = await fetchKindStats();

  // Opponent mode comes from a cookie so the first server-rendered hand already
  // respects the preference (localStorage is invisible to the server).
  const cookieStore = await cookies();
  const initialOppMode = parseOppMode(cookieStore.get(OPP_MODE_COOKIE)?.value);

  // One seed per page load. The client derives every subsequent hand from it,
  // so SSR and hydration agree on the first question.
  //
  // The react-hooks purity rule targets client components, where an impure call
  // during render makes re-renders disagree. This is a server component: it runs
  // once per request, and per-request randomness is precisely the intent — a
  // pure seed would deal every visitor the same opening hand.
  // eslint-disable-next-line react-hooks/purity
  const seed = Math.floor(Math.random() * 2 ** 31);

  return (
    <DrillShell
      initialTab={initialTab}
      initialOppMode={initialOppMode}
      seed={seed}
      kindStats={kindStats}
    />
  );
}
