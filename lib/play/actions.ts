/**
 * Action-code parsing and display for the play mode. Codes come from the
 * solver export ("X", "F", "C", "B18", "R45", "A975") — amounts are the
 * wager for the current street, in chips. Display follows the drills'
 * dollar convention ($1 per chip).
 */
import { money } from "../drill/opts";
import type { ActionCode } from "./types";

export type ActionKind = "check" | "fold" | "call" | "bet" | "raise" | "allin";

export interface ActionInfo {
  code: ActionCode;
  kind: ActionKind;
  /** Street wager target in chips, for bet/raise/allin. */
  to?: number;
}

/**
 * Money with cents when they exist — EV losses come in $0.50 steps, and the
 * drills' whole-dollar `money()` would round "$0.50" up to "$1" (a 100%
 * overstatement of the smallest loss).
 */
export const moneyExact = (v: number): string => {
  const abs = Math.abs(v);
  return "$" + (Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toFixed(2));
};

/** "+$12.50" / "−$3" — true minus sign, like the drills' signedMoney. */
export const signedMoneyExact = (v: number): string =>
  (v >= 0 ? "+" : "−") + moneyExact(v);

export function parseAction(code: ActionCode): ActionInfo {
  if (code === "X") return { code, kind: "check" };
  if (code === "F") return { code, kind: "fold" };
  if (code === "C") return { code, kind: "call" };
  const to = Number(code.slice(1));
  if (!Number.isFinite(to)) throw new Error(`bad action code: ${code}`);
  if (code[0] === "B") return { code, kind: "bet", to };
  if (code[0] === "R") return { code, kind: "raise", to };
  if (code[0] === "A") return { code, kind: "allin", to };
  throw new Error(`bad action code: ${code}`);
}

/**
 * Button / feed label. `pot` is the pot at the decision (starting pot plus
 * all wagers), `toCall` what the actor must add to continue.
 */
export function actionDisplay(
  info: ActionInfo,
  ctx: { pot: number; toCall: number }
): string {
  switch (info.kind) {
    case "check":
      return "Check";
    case "fold":
      return "Fold";
    case "call":
      return ctx.toCall > 0 ? `Call ${money(ctx.toCall)}` : "Call";
    case "bet": {
      // The pot the bet is sized against excludes the bet itself.
      const pct = Math.round((info.to! / ctx.pot) * 100);
      return `Bet ${money(info.to!)} (${pct}%)`;
    }
    case "raise":
      return `Raise to ${money(info.to!)}`;
    case "allin":
      return `All-in ${money(info.to!)}`;
  }
}
