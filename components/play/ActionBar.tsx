"use client";

import { parseAction } from "@/lib/play/actions";
import { actionLabelBb } from "@/lib/play/labels";

export interface ActionBarProps {
  codes: readonly string[];
  potChips: number;
  toCallChips: number;
  disabled: boolean;
  onAct: (index: number) => void;
}

/**
 * The action controls.
 *
 * Sizes are discrete buttons, never a slider: `node.a` is a fixed list of
 * solver action codes, and a slider would offer sizes the solver has no policy
 * for and therefore no way to grade — the same class of error as hand-coding
 * an out count in the drills.
 *
 * Keyboard is owned by PlayShell (1..n, plus F and C). There is deliberately
 * no R shortcut: a node can offer several raise sizes, so one key cannot name
 * a raise unambiguously, and binding it to "the first raise" would silently
 * submit a size the player did not choose.
 */
export function ActionBar({ codes, potChips, toCallChips, disabled, onAct }: ActionBarProps) {
  return (
    <div className="pt-actions" role="group" aria-label="Your action">
      {codes.map((code, i) => {
        const kind = parseAction(code).kind;
        const tone =
          kind === "fold" ? "fold" : kind === "check" || kind === "call" ? "call" : "raise";
        return (
          <button
            key={code}
            className={`pt-action ${tone}`}
            disabled={disabled}
            onClick={() => onAct(i)}
          >
            <span className="key">{i + 1}</span>
            <span>{actionLabelBb(code, { potChips, toCallChips })}</span>
          </button>
        );
      })}
    </div>
  );
}
