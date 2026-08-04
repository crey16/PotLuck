/**
 * Button and feed copy for the play table, in big blinds.
 *
 * The dollar-based `actionDisplay` in ./actions stays where it is — the saved
 * hand review still uses it — but everything on the live table reads in bb,
 * because that is the unit every solver tool and every player uses, and stack
 * depths only make sense in bb.
 *
 * Pure and neutral (no "use client"), so both the table and any server-side
 * caller can import it — see components/drill/clientBoundary.test.ts for why
 * that matters.
 */
import { parseAction } from "./actions";
import { bb } from "./units";

export interface ActionLabelCtx {
  /** Pot at the decision: starting pot plus all wagers so far, in chips. */
  potChips: number;
  /** What the actor must add to continue, in chips. Zero when checked to. */
  toCallChips: number;
}

export function actionLabelBb(code: string, ctx: ActionLabelCtx): string {
  const info = parseAction(code);
  switch (info.kind) {
    case "check":
      return "Check";
    case "fold":
      return "Fold";
    case "call":
      return ctx.toCallChips > 0 ? `Call ${bb(ctx.toCallChips)}` : "Call";
    case "bet": {
      // Sized against the pot BEFORE this bet, which is how the solver sizes it.
      const pct = Math.round((info.to! / ctx.potChips) * 100);
      return `Bet ${bb(info.to!)} (${pct}%)`;
    }
    case "raise":
      return `Raise to ${bb(info.to!)}`;
    case "allin":
      return `All-in ${bb(info.to!)}`;
  }
}
