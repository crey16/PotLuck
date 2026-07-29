import { Header } from "@/components/ui/Header";
import { OutsDrill } from "@/components/drill/OutsDrill";

/**
 * Thin server component for the "Count your outs" drill. No auth/profile
 * fetch yet (Task 3 lands after this task) — Header and OutsDrill both
 * render fine with no user props, and take profile-derived props later
 * without any contract change here.
 */
export default function OutsDrillPage() {
  return (
    <div className="wrap">
      <Header />
      <OutsDrill />
    </div>
  );
}
