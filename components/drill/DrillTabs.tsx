"use client";

import { TAB_ORDER, TAB_LABELS, REGISTERED_KINDS, type TabId } from "@/lib/drill/registry";

export interface DrillTabsProps {
  active: TabId;
  onSelect: (tab: TabId) => void;
}

/** Mixed + every registered kind + Reference. Unimplemented kinds are hidden
 *  rather than shown broken, so the app is runnable mid-milestone. */
export function DrillTabs({ active, onSelect }: DrillTabsProps) {
  const registered = new Set<string>(REGISTERED_KINDS());
  const tabs = TAB_ORDER.filter((t) => t === "mixed" || t === "reference" || registered.has(t));
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button
          key={t}
          className={`tab${t === active ? " active" : ""}`}
          onClick={() => onSelect(t)}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
