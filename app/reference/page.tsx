import Link from "next/link";
import { ReferenceTab } from "@/components/drill/ReferenceTab";
import { DRILL_KINDS, type DrillKind } from "@/lib/drill/contract";
import { KIND_LABELS, drillHref } from "@/lib/drill/registry";

export const metadata = { title: "Reference — PotLuck" };

export default async function ReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const rawFrom = (await searchParams).from;
  const from = typeof rawFrom === "string" && DRILL_KINDS.includes(rawFrom as DrillKind)
    ? rawFrom as DrillKind
    : null;

  return (
    <main className="page-narrow">
      <div
        style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: "var(--space-6)", flexWrap: "wrap",
          borderBottom: "1px solid var(--color-divider)",
          paddingBottom: "var(--space-4)", marginBottom: "var(--space-8)",
        }}
      >
        <div>
          <div className="mono-label accent" style={{ letterSpacing: ".14em", marginBottom: 6 }}>
            Open from any drill with R
          </div>
          <h1 style={{ fontSize: 44, lineHeight: 1, margin: 0 }}>Reference</h1>
        </div>
        <Link href={from ? drillHref(from) : "/drill"} className="btn btn-secondary btn-caps">
          Back to {from ? KIND_LABELS[from].toLowerCase() : "the drill"}
        </Link>
      </div>
      <ReferenceTab />
    </main>
  );
}
