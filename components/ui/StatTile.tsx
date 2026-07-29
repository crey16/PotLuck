export interface StatTileProps {
  label: string;
  value: string | number;
  sub?: string;
  /** 0-100 fill for the `.meter` bar (e.g. accuracy). */
  meterPercent?: number;
  /** Filled pip count out of 3 (e.g. level), rendered as `.lvlpips`. */
  pips?: number;
}

/** A single reference `.tile` — score/accuracy/streak/level style stat card. */
export function StatTile({ label, value, sub, meterPercent, pips }: StatTileProps) {
  const clampedPercent =
    meterPercent === undefined ? undefined : Math.min(100, Math.max(0, meterPercent));

  return (
    <div className="tile">
      <div className="lab">{label}</div>
      <div className="val">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
      {clampedPercent !== undefined && (
        <div className="meter">
          <i style={{ width: `${clampedPercent}%` }} />
        </div>
      )}
      {pips !== undefined && (
        <div className="lvlpips">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < pips ? "on" : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
