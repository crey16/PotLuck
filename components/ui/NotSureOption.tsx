import { UNSURE_KEY_HINT } from "@/lib/drill/unsureUi";

export interface NotSureOptionProps {
  /** True once any answer has landed — the button freezes with the rest. */
  answered: boolean;
  /** True when "Not sure" is what the player actually submitted. */
  picked: boolean;
  onClick: () => void;
}

/**
 * The one "Not sure" affordance (M8.5C), shared by the drill room, lesson
 * screens, authored scenarios, table scenarios and the placement assessment,
 * so it looks and behaves identically everywhere an answer is submitted.
 *
 * It sits BELOW the option grid behind a rule, at a lighter weight and without
 * the `.opt` treatment, because the brief is explicit that it must never be
 * mistaken for one of the real choices. Cheap to reach, impossible to click by
 * accident while scanning the answers.
 */
export function NotSureOption({ answered, picked, onClick }: NotSureOptionProps) {
  return (
    <div className={`not-sure${picked ? " picked" : ""}`}>
      <button
        type="button"
        className="not-sure-btn"
        disabled={answered}
        onClick={onClick}
        aria-label="Not sure — show me the answer"
      >
        <span className="key">{UNSURE_KEY_HINT}</span>
        <span>Not sure — show me the answer</span>
      </button>
      <span className="not-sure-note">
        {picked
          ? "Counted as a miss, but recorded as a gap rather than a wrong belief — and it will not move your difficulty."
          : "Honest beats lucky. Guessing right teaches you nothing."}
      </span>
    </div>
  );
}
