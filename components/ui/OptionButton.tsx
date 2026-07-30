import type { ReactNode } from "react";

export type OptionButtonState = "idle" | "correct" | "wrong" | "disabled";

export interface OptionButtonProps {
  /** The key-hint square shown before the label, e.g. "1". */
  keyHint: string;
  state?: OptionButtonState;
  onClick?: () => void;
  children: ReactNode;
}

/** A single `.opt` answer button. Correct and wrong never rely on hue alone —
 *  each carries a glyph, a wordmark and a border weight. */
export function OptionButton({
  keyHint,
  state = "idle",
  onClick,
  children,
}: OptionButtonProps) {
  const stateClass =
    state === "correct" ? "correct" : state === "wrong" ? "wrong" : state === "disabled" ? "faded" : "";
  const isDisabled = state !== "idle";
  const classes = ["opt", stateClass].filter(Boolean).join(" ");

  return (
    <button className={classes} disabled={isDisabled} onClick={onClick}>
      <span className="key">{keyHint}</span>
      <span>{children}</span>
      {state === "correct" && (
        <span className="mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          correct
        </span>
      )}
      {state === "wrong" && (
        <span className="mark">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          your pick
        </span>
      )}
    </button>
  );
}
