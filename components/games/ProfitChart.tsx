"use client";

// Cumulative net over time as a plain inline SVG — no chart library, and
// sized for a phone. Money is cents in, cents out; formatting only at the
// axis labels.

import { formatCents } from "@/lib/games/money";

export function ProfitChart({
  series,
}: {
  series: { date: string; cumulativeNetCents: number }[];
}) {
  if (series.length === 0) {
    return <p className="text-dim" style={{ margin: 0 }}>No sessions yet.</p>;
  }

  const width = 320;
  const height = 120;
  const pad = 6;
  const values = series.map((p) => p.cumulativeNetCents);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) =>
    series.length === 1
      ? width / 2
      : pad + (i * (width - 2 * pad)) / (series.length - 1);
  const y = (v: number) => pad + ((max - v) * (height - 2 * pad)) / span;

  const points = series.map((p, i) => `${x(i)},${y(p.cumulativeNetCents)}`).join(" ");
  const last = values[values.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cumulative net, ${series.length} sessions, now ${formatCents(last, true)}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* zero line */}
        <line
          x1={0}
          x2={width}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-divider)"
          strokeDasharray="4 4"
        />
        <polyline
          points={points}
          fill="none"
          stroke={last >= 0 ? "var(--good)" : "var(--crit)"}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {series.length <= 30 &&
          series.map((p, i) => (
            <circle
              key={p.date + i}
              cx={x(i)}
              cy={y(p.cumulativeNetCents)}
              r={2.5}
              fill={p.cumulativeNetCents >= 0 ? "var(--good)" : "var(--crit)"}
            />
          ))}
      </svg>
      <div
        className="text-dim"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
      >
        <span>{series[0].date}</span>
        <span style={{ color: last >= 0 ? "var(--good)" : "var(--crit)" }}>
          {formatCents(last, true)}
        </span>
        <span>{series[series.length - 1].date}</span>
      </div>
    </div>
  );
}
