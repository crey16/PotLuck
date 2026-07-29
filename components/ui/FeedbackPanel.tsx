import type { ReactNode } from "react";

export interface FeedbackPanelProps {
  /** Whether the answer was correct — drives the `.fb.ok`/`.fb.no` bar color. */
  ok: boolean;
  /** The bar's headline text. */
  message: string;
  /** Worked-math content, e.g. one or more `<WorkTable>`. */
  children?: ReactNode;
  /** Optional callout rendered as `.note` below the body. */
  note?: string;
  /** Use the amber `.note.warnl` variant instead of the default blue accent. */
  noteWarn?: boolean;
}

/** The reference `.fb` feedback panel shown after answering. */
export function FeedbackPanel({ ok, message, children, note, noteWarn = false }: FeedbackPanelProps) {
  const classes = ["fb", "show", ok ? "ok" : "no"].join(" ");

  return (
    <div className={classes}>
      <div className="bar">{message}</div>
      <div className="body">
        {children}
        {note !== undefined && (
          <div className={noteWarn ? "note warnl" : "note"}>{note}</div>
        )}
      </div>
    </div>
  );
}

export interface WorkTableProps {
  children: ReactNode;
}

/** Wraps `WorkRow`s in the reference `.work` tabular-numeric layout. */
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
