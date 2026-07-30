import {
  cellFrequency,
  getScenario,
  handAt,
  rangePercent,
  type Action,
} from "@/lib/poker/ranges";

export interface RangeGridProps {
  scenarioId: string;
  highlight?: string;
}

/** Same three colours the reference trainer uses for raise / call / fold. */
const ACTION_COLOR: Record<Action, string> = {
  r: "var(--orange)",
  c: "var(--aqua)",
  f: "var(--surface-3)",
};

/**
 * Renders the reference trainer's `gridHTML` + `legendHTML`
 * (poker-math-trainer.html lines 1069-1088) as React, using the tested range
 * engine (`lib/poker/ranges.ts`) for every frequency and percentage — nothing
 * here is hard-coded.
 */
export function RangeGrid({ scenarioId, highlight }: RangeGridProps) {
  const scenario = getScenario(scenarioId);
  if (!scenario) return null;

  const cells: { hand: string; bg: string; dim: boolean; pick: boolean; title: string }[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const hand = handAt(i, j);
      const f = cellFrequency(scenario, hand);
      const rp = f.r * 100;
      const cp = (f.r + f.c) * 100;
      const bg =
        f.r >= 0.999
          ? ACTION_COLOR.r
          : f.c >= 0.999
            ? ACTION_COLOR.c
            : f.f >= 0.999
              ? ACTION_COLOR.f
              : `linear-gradient(to top, ${ACTION_COLOR.r} 0 ${rp.toFixed(1)}%, ` +
                `${ACTION_COLOR.c} ${rp.toFixed(1)}% ${cp.toFixed(1)}%, ` +
                `${ACTION_COLOR.f} ${cp.toFixed(1)}% 100%)`;
      const title =
        `${hand} — ${Math.round(f.r * 100)}% ${scenario.c ? "3-bet" : "raise"}` +
        (scenario.c ? `, ${Math.round(f.c * 100)}% call` : "") +
        `, ${Math.round(f.f * 100)}% fold`;
      cells.push({ hand, bg, dim: f.f >= 0.999, pick: hand === highlight, title });
    }
  }

  const totalPlayed = rangePercent(scenario, "r") + rangePercent(scenario, "c");

  return (
    <div>
      <div className="legend">
        {scenario.actions.map(([key, label]) => (
          <span className="lg" key={key}>
            <i style={{ background: ACTION_COLOR[key] }} />
            {label}
            {key !== "f" && <> <b>{rangePercent(scenario, key).toFixed(1)}%</b></>}
          </span>
        ))}
        <span className="lg" style={{ color: "var(--muted)" }}>
          Total played <b>{totalPlayed.toFixed(1)}%</b>
        </span>
      </div>
      <div className="grid13">
        {cells.map((c) => (
          <div
            key={c.hand}
            className={`gc${c.dim ? " dim" : ""}${c.pick ? " pick" : ""}`}
            style={{ background: c.bg }}
            title={c.title}
          >
            {c.hand}
          </div>
        ))}
      </div>
    </div>
  );
}
