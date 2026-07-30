import {
  cellFrequency,
  getScenario,
  handAt,
  rangePercent,
} from "@/lib/poker/ranges";

export interface RangeGridProps {
  scenarioId: string;
  highlight?: string;
}

/** Value steps of one hue, per the redesign: raise/3-bet is the dark accent,
 *  call the light accent, fold transparent with a hairline border. Split
 *  cells are mixed frequencies, filled bottom-up. */
const RAISE = "var(--color-accent-800)";
const CALL = "var(--color-accent-300)";

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
      const dim = f.f >= 0.999;
      const bg = dim
        ? "transparent"
        : f.r >= 0.999
          ? RAISE
          : f.c >= 0.999
            ? CALL
            : `linear-gradient(to top, ${RAISE} 0 ${rp.toFixed(1)}%, ` +
              `${CALL} ${rp.toFixed(1)}% ${cp.toFixed(1)}%, transparent ${cp.toFixed(1)}% 100%)`;
      const title =
        `${hand} — ${Math.round(f.r * 100)}% ${scenario.c ? "3-bet" : "raise"}` +
        (scenario.c ? `, ${Math.round(f.c * 100)}% call` : "") +
        `, ${Math.round(f.f * 100)}% fold`;
      cells.push({ hand, bg, dim, pick: hand === highlight, title });
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
                  ? { border: "1px solid var(--color-divider)" }
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
            className={`gc${c.dim ? " dim" : ""}${c.pick ? " pick" : ""}`}
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
