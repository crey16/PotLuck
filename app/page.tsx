import { redirect } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

/**
 * Authenticated users are redirected straight to the drill. Unauthenticated
 * hits are already sent to /login by middleware — this only fires when
 * Supabase isn't configured yet (middleware is a passthrough) or when a
 * signed-in user lands here directly.
 */
export default async function Home() {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/drill");
    }
  }

  // Reachable only when Supabase isn't configured yet (no .env.local) —
  // middleware becomes a passthrough in that case, so a signed-out hit on
  // "/" isn't redirected to /login. Every other signed-out request is
  // already sent to /login by middleware before this component runs.
  return (
    <div className="wrap">
      <Header />
      <div className="panel">
        <div className="prompt">HCWK Wizard</div>
        <p className="sub">
          Lessons-style poker training: math drills for counting outs, pot
          odds, EV, bluffs and more, with adaptive difficulty.{" "}
          <a href="/drill">Open the drill</a>.
        </p>
      </div>
    </div>
  );
}
