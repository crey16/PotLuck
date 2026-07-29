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
      redirect("/drill/outs");
    }
  }

  return (
    <div className="wrap">
      <Header />
      <div className="panel">
        <div className="prompt">Design system port</div>
        <p className="sub">
          Tokens and UI primitives are in place. Real routing and drills land
          in the next task.
        </p>
      </div>
    </div>
  );
}
