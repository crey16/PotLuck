import type { Metadata } from "next";
import Link from "next/link";
import { PlacementPlayer } from "@/components/placement/PlacementPlayer";
import { supabaseConfigured } from "@/lib/supabase/env";
import { getAuthUserId } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Placement · PotLuck",
  description: "A short assessment that decides where your learning path starts.",
};

/**
 * The M8.5B placement assessment (route).
 *
 * Directly linkable and always available, which is what makes retaking it
 * possible: a player who skipped, or whose game has moved on since, can come
 * back here whenever they like. `/` routes brand-new accounts in
 * automatically; nobody is ever held here.
 */
export default async function PlacementPage() {
  if (!supabaseConfigured() || !(await getAuthUserId())) {
    return (
      <main className="page-narrow placement-page">
        <section className="blueprint placement-result">
          <div className="mono-label accent">Placement</div>
          <h1>Sign in to be placed.</h1>
          <p className="text-dim">
            The assessment stores your result against your account, so it needs one.
          </p>
          <div className="placement-actions">
            <Link href="/login" className="btn btn-primary blueprint btn-caps">Sign in</Link>
            <Link href="/drill" className="btn btn-secondary btn-caps">Just drill</Link>
          </div>
        </section>
      </main>
    );
  }

  // One seed per page load, mirroring app/drill/page.tsx: the client derives
  // every question from it, so SSR and hydration agree on the first one.
  //
  // The react-hooks purity rule targets client components, where an impure call
  // during render makes re-renders disagree. This is a server component: it runs
  // once per request, and per-request randomness is precisely the intent.
  // eslint-disable-next-line react-hooks/purity
  const seed = Math.floor(Math.random() * 2 ** 31);

  return <PlacementPlayer seed={seed} />;
}
