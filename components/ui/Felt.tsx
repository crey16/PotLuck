import type { ReactNode } from "react";

export interface FeltProps {
  children: ReactNode;
}

/** The grid-lined table strip. Compose with `<Seat>` and `<Divider>`. */
export function Felt({ children }: FeltProps) {
  return <div className="felt seats">{children}</div>;
}

export interface SeatProps {
  /** e.g. "Your hand", "Board — flop", "Villain — shown" */
  label: string;
  /** Accent the label (the mockup accents the villain seat). */
  accent?: boolean;
  children: ReactNode;
}

/** A `.seat` — a labelled hand of `PlayingCard`s. */
export function Seat({ label, accent = false, children }: SeatProps) {
  return (
    <div className="seat">
      <div className={accent ? "who accent" : "who"}>{label}</div>
      <div className="hand">{children}</div>
    </div>
  );
}

/** The vertical `.divider` between seats. */
export function Divider() {
  return <div className="divider" />;
}
