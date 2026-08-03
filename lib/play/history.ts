import type { PlayDecisionReview, PlayStatus } from "./api";

export const PLAY_STREET_ORDER = ["preflop", "flop", "turn", "river"] as const;

export function formatFrequency(value: number | null): string {
  if (value === null) return "Unknown";
  const percentage = value <= 1 ? value * 100 : value;
  const rounded = Math.round(percentage * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function formatEvBb(value: number | null, signed = false): string {
  if (value === null) return "Unknown";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}bb`;
}

export function formatEvLossBb(value: number | null): string {
  if (value === null) return "EV unknown";
  return value === 0 ? "0.00bb" : `−${Math.abs(value).toFixed(2)}bb`;
}

export function statusCopy(status: PlayStatus): string {
  if (status === "completed") return "Complete";
  if (status === "abandoned") return "Abandoned";
  return "Incomplete";
}

export function gradingCopy(decision: PlayDecisionReview): string {
  if (decision.grading_status === "legacy_unverified") return "Legacy — unverified";
  if (decision.grading_status === "ungraded") return "Ungraded";
  if (decision.grading_source === "solver") return "Solver graded";
  if (decision.grading_source === "reference") return "Reference graded";
  return "Ungraded";
}

export function displayCards(cards: string | readonly string[]): string {
  if (typeof cards !== "string") return cards.length ? cards.join(" ") : "—";
  if (!cards) return "—";
  return cards.match(/.{1,2}/g)?.join(" ") ?? cards;
}
