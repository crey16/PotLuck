"use client";

import { useRef, useState } from "react";

import {
  inputType,
  isRevealKey,
  nextRevealed,
  revealLabel,
} from "@/lib/ui/holdReveal";

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
}

/**
 * A password input with a press-and-hold reveal.
 *
 * Typing a password blind is the first thing a new account does, and a typo
 * there is indistinguishable from a wrong password — the error message is the
 * same either way. Holding the eye is the cheapest way to tell them apart.
 *
 * `nextRevealed` decides; this only draws and wires events. Every pointer,
 * keyboard and focus path that can end a hold is bound, because the failure
 * mode of missing one is a password left visible on screen.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="field" style={{ marginBottom: "var(--space-4)" }}>
      <label htmlFor={id}>{label}</label>
      <div className="field-with-affix">
        <input
          ref={inputRef}
          id={id}
          className="input input-affixed"
          type={inputType(revealed)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="field-affix"
          aria-label={revealLabel(revealed)}
          // Keep focus in the password input: a pointer press must not steal
          // the caret, or holding the eye would move the cursor out of the
          // field the player is mid-way through typing.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={() => setRevealed(nextRevealed("press"))}
          onPointerUp={() => setRevealed(nextRevealed("release"))}
          onPointerLeave={() => setRevealed(nextRevealed("leave"))}
          onPointerCancel={() => setRevealed(nextRevealed("cancel"))}
          onBlur={() => setRevealed(nextRevealed("blur"))}
          onKeyDown={(e) => {
            if (!isRevealKey(e.key)) return;
            // Space would scroll the page and Enter would submit the form.
            e.preventDefault();
            if (e.repeat) return;
            setRevealed(nextRevealed("press"));
          }}
          onKeyUp={(e) => {
            if (!isRevealKey(e.key)) return;
            e.preventDefault();
            setRevealed(nextRevealed("release"));
          }}
        >
          {revealed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
              <path d="M3 3l18 18" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
