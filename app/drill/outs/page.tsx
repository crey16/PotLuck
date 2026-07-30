import { redirect } from "next/navigation";

/** M1 shipped this URL; M2 moved the drills onto one tabbed page. */
export default function OutsDrillPage() {
  redirect("/drill?tab=outs");
}
