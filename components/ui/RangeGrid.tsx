import {
  cellFrequency,
  getScenario,
  handAt,
  rangePercent,
} from "@/lib/poker/ranges";
import { rangeCellAppearance } from "@/components/ui/rangeCell";

export interface RangeGridProps {
  scenarioId: string;
  highlight?: string;
}

/** Value steps of one hue, per the v2 redesign: raise/3-bet is the solid
 *  accent, call the light accent, fold transparent with a hairline border. Split
 *  cells are mixed frequencies, filled bottom-up — see rangeCell.ts for why
 *  those carry their own modifier class. */
const RAISE = "var(--color-accent)";
const CALL = "var(--color-accent-200)";

export function RangeGrid({ scenarioId, highlight }: RangeGridProps) {
  const scenario = getScenario(scenarioId);
  if (!scenario) return null;

  const cells: { hand: string; bg: string; mod: string; pick: boolean; title: string }[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const hand = handAt(i, j);
      const f = cellFrequency(scenario, hand);
      const { background, className } = rangeCellAppearance(f);
      const title =
        `${hand} — ${Math.round(f.r * 100)}% ${scenario.c ? "3-bet" : "raise"}` +
        (scenario.c ? `, ${Math.round(f.c * 100)}% call` : "") +
        `, ${Math.round(f.f * 100)}% fold`;
      cells.push({ hand, bg: background, mod: className, pick: hand === highlight, title });
    }
  }

  const totalPlayed = rangePercent(scenario, "r") + rangePercent(scenario, "c");

  return (
    <div>
      <div className="legend-line">
        {scenario.actions.map(([key, label]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <i
              className="sw"
              style={
                key === "f"
                  ? { border: "1px solid var(--line)" }
                  : { background: key === "r" ? RAISE : CALL }
              }
            />
            {label}
            {key !== "f" && <b>&nbsp;{rangePercent(scenario, key).toFixed(1)}%</b>}
          </span>
        ))}
        <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          Split cell = mixed frequency, filled bottom-up
        </span>
        <span style={{ marginLeft: "auto", color: "var(--color-accent-700)" }}>
          Total played <b>&nbsp;{totalPlayed.toFixed(1)}%</b>
        </span>
      </div>
      <div className="grid13">
        {cells.map((c) => (
          <div
            key={c.hand}
            className={`gc${c.mod ? ` ${c.mod}` : ""}${c.pick ? " pick" : ""}`}
            style={{ background: c.bg }}
            title={c.title}
          >
            {c.hand}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex", justifyContent: "space-between", marginTop: "var(--space-3)",
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        <span>Suited above the diagonal · pairs on it · offsuit below</span>
        {highlight && <span>{highlight} outlined — the hand you were dealt</span>}
      </div>
    </div>
  );
}
