import type { ReactNode } from "react";

export interface FeltProps {
  children: ReactNode;
}

/** The reference `.felt` table container. Compose with `<Seat>` and `<Divider>`. */
export function Felt({ children }: FeltProps) {
  return <div className="felt">{children}</div>;
}

export interface SeatProps {
  /** e.g. "You", "Villain", "Board" */
  label: string;
  children: ReactNode;
}

/** A `.seat` — a labelled hand of `PlayingCard`s. */
export function Seat({ label, children }: SeatProps) {
  return (
    <div className="seat">
      <div className="who">{label}</div>
      <div className="hand">{children}</div>
    </div>
  );
}

/** The vertical `.divider` between seats. */
export function Divider() {
  return <div className="divider" />;
}
