import type { ReactNode } from "react";

export type OptionButtonState = "idle" | "correct" | "wrong" | "disabled";

export interface OptionButtonProps {
  /** The key-hint square shown before the label, e.g. "A". */
  keyHint: string;
  state?: OptionButtonState;
  onClick?: () => void;
  children: ReactNode;
}

/** A single reference `.opt` answer button. */
export function OptionButton({
  keyHint,
  state = "idle",
  onClick,
  children,
}: OptionButtonProps) {
  const stateClass = state === "correct" || state === "wrong" ? state : "";
  const isDisabled = state !== "idle";
  const classes = ["opt", stateClass].filter(Boolean).join(" ");

  return (
    <button className={classes} disabled={isDisabled} onClick={onClick}>
      <span className="key">{keyHint}</span>
      <span>{children}</span>
      {state === "correct" && <span className="mark">✓</span>}
      {state === "wrong" && <span className="mark">✗</span>}
    </button>
  );
}
