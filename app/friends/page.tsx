import { FriendsShell } from "@/components/social/FriendsShell";

export const metadata = { title: "Friends — PotLuck" };

export default function FriendsPage() {
  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      <div className="section-head">
        <h1 style={{ fontSize: 40, lineHeight: 1 }}>Friends</h1>
        <span className="lede">
          Friends see your profile, stats and streaks — and you see theirs.
        </span>
      </div>
      <FriendsShell />
    </main>
  );
}
