export interface PillsProps {
  items: { label: string; value: string }[];
}

/** Renders the `money` ViewBlock — the pot / bet / to-call strip. */
export function Pills({ items }: PillsProps) {
  return (
    <div className="potbar">
      {items.map((p) => (
        <div className="pill" key={p.label}>
          <div className="k">{p.label}</div>
          <div className="v">{p.value}</div>
        </div>
      ))}
    </div>
  );
}
