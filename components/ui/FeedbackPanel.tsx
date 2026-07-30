import type { ReactNode } from "react";

/* The old FeedbackPanel wrapper is gone — the redesigned feedback markup
 * lives in DrillPlayer (.fb / .bar / .body). What remains here is the
 * worked-derivation table the explain bodies still compose. */

export interface WorkTableProps {
  children: ReactNode;
}

/** Wraps `WorkRow`s in the tabular-numeric derivation layout. */
export function WorkTable({ children }: WorkTableProps) {
  return <div className="work">{children}</div>;
}

export interface WorkRowProps {
  label: string;
  value: string | number;
}

/** A single labelled `.row` inside a `WorkTable` — pot odds, EV, etc. */
export function WorkRow({ label, value }: WorkRowProps) {
  return (
    <div className="row">
      <div className="lbl">{label}</div>
      <div className="num">{value}</div>
    </div>
  );
}
