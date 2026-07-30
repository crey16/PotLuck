export interface MoneyStripProps {
  items: { label: string; value: string }[];
}

/** The pot / bet / to-call strip: bordered stat cells over the felt grid.
 *  The cell you must pay ("to call" / "you call") keeps the accent outline. */
export function MoneyStrip({ items }: MoneyStripProps) {
  return (
    <div
      className="money-strip"
      style={{
        gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`,
        marginBottom: "var(--space-6)",
      }}
    >
      {items.map((p) => {
        const hi = /\bcall\b/i.test(p.label) && !/pot/i.test(p.label);
        return (
          <div className={hi ? "money-cell hi" : "money-cell"} key={p.label}>
            <div className="k">{p.label}</div>
            <div className="v">{p.value}</div>
          </div>
        );
      })}
    </div>
  );
}
