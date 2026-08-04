import Link from "next/link";
import { nudgeFor, type Nudge } from "@/lib/learn/nudge";
import type { NewPlayerRouting } from "@/lib/placement/server";
import { DismissNudgeButton } from "./DismissNudgeButton";

export interface StartHereNudgeProps {
  routing: Pick<NewPlayerRouting, "status" | "hasStartedLearning">;
  /** Read from the cookie by the server component that renders this. */
  dismissed: boolean;
}

/**
 * The soft on-ramp for a player with no lessons behind them.
 *
 * The M8.5A landing-page reorder was reverted because a first-run problem does
 * not justify restructuring the permanent home page. This banner is what
 * replaced it: lesson-first is now a ROUTING property — signup goes through
 * placement into `/learn` — and this is the recovery path for everyone that
 * routing missed. It never blocks anything, and it disappears for good once
 * the player finishes a lesson or dismisses it.
 *
 * Server component. `nudgeFor` decides; this only draws.
 */
export function StartHereNudge({ routing, dismissed }: StartHereNudgeProps) {
  const nudge: Nudge | null = nudgeFor(routing, dismissed);
  if (!nudge) return null;

  return (
    <aside className={`start-here start-here-${nudge.kind}`}>
      <div className="start-here-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>
      <div className="start-here-text">
        <strong>{nudge.title}</strong>
        <span>{nudge.body}</span>
      </div>
      <div className="start-here-actions">
        <Link href={nudge.href} className="btn btn-primary blueprint btn-caps">
          {nudge.cta}
        </Link>
        <DismissNudgeButton />
      </div>
    </aside>
  );
}
