// Skill-strength bars and the 12-week activity heatmap, shared between the
// home dashboard and profile pages. Server-component friendly (no state).

import type { SkillStat } from "@/lib/drill/serverStats";

export function SkillRow({ skill, weak }: { skill: SkillStat; weak: boolean }) {
  return (
    <div className={`skill-row${weak ? " weak" : ""}`}>
      <span className="name" style={weak ? { display: "flex", alignItems: "center", gap: 6 } : undefined}>
        {weak && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.5">
            <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
          </svg>
        )}
        {skill.label}
      </span>
      <span
        className="meter thin"
        style={weak ? { borderColor: "var(--warn)" } : undefined}
      >
        <i
          className={weak ? "hatch" : undefined}
          style={
            weak
              ? {
                  width: `${skill.accuracy}%`,
                  color: "var(--warn)",
                  backgroundColor: "color-mix(in srgb, var(--warn) 22%, transparent)",
                }
              : { width: `${skill.accuracy}%` }
          }
        />
      </span>
      <span className="pct" style={weak ? { color: "var(--warn)" } : undefined}>
        {skill.attempts > 0 ? `${skill.accuracy}%` : "—"}{" "}
        <span className="n" style={weak ? { opacity: 0.7, color: "inherit" } : undefined}>
          /{skill.attempts}
        </span>
      </span>
    </div>
  );
}

export function heatFill(xp: number): string | null {
  if (xp <= 0) return null;
  if (xp >= 100) return "var(--color-accent)";
  if (xp >= 60) return "color-mix(in srgb, var(--color-accent) 75%, transparent)";
  if (xp >= 30) return "color-mix(in srgb, var(--color-accent) 50%, transparent)";
  return "color-mix(in srgb, var(--color-accent) 25%, transparent)";
}

export interface HeatmapDay {
  date: string;
  xp: number;
  future: boolean;
}

/** 12 columns of weeks (oldest → newest), rows Monday → Sunday. */
export function buildHeatmapWeeks(
  activity: { date: string; xp: number }[],
  today: Date = new Date()
): HeatmapDay[][] {
  const xpByDate = new Map(activity.map((a) => [a.date, a.xp]));
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow);
  const weeks: HeatmapDay[][] = [];
  for (let w = 11; w >= 0; w--) {
    const col: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() - w * 7 + d);
      const iso = day.toISOString().slice(0, 10);
      col.push({ date: iso, xp: xpByDate.get(iso) ?? 0, future: day > today });
    }
    weeks.push(col);
  }
  return weeks;
}

export function ActivityHeatmap({ weeks }: { weeks: HeatmapDay[][] }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
      <div
        style={{
          display: "grid", gridTemplateRows: "repeat(7, 15px)", gap: 3,
          fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".06em",
          color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
          textAlign: "right", paddingTop: 1,
        }}
      >
        <span>MON</span><span /><span>WED</span><span /><span>FRI</span><span /><span>SUN</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 15px)", gridTemplateRows: "repeat(7, 15px)", gap: 3 }}>
        {weeks.map((col, w) =>
          col.map((day, d) => {
            const fill = day.future ? null : heatFill(day.xp);
            return (
              <div
                key={day.date}
                title={`${day.xp} XP`}
                className={`heat-cell${fill ? "" : " empty"}`}
                style={{
                  gridColumn: w + 1,
                  gridRow: d + 1,
                  background: fill ?? "transparent",
                  opacity: day.future ? 0.35 : 1,
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
