import { GroupsShell } from "@/components/games/GroupsShell";

export const metadata = { title: "Home Games — PotLuck" };

export default function GamesPage() {
  return (
    <main className="page page-narrow" style={{ paddingTop: "var(--space-8)" }}>
      <div className="section-head">
        <h1 style={{ fontSize: 40, lineHeight: 1 }}>Home games</h1>
        <span className="lede">
          Track your real games — buy-ins, cash-outs, and who is actually up
          over months. Kept fully separate from your training stats.
        </span>
      </div>
      <GroupsShell />
    </main>
  );
}
