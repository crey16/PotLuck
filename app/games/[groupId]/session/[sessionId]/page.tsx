import { SessionShell } from "@/components/games/SessionShell";

export const metadata = { title: "Session — PotLuck" };

export default async function SessionPage({
  params,
}: {
  params: Promise<{ groupId: string; sessionId: string }>;
}) {
  const { groupId, sessionId } = await params;
  return (
    <main className="page page-narrow" style={{ paddingTop: "var(--space-8)" }}>
      <SessionShell groupId={groupId} sessionId={sessionId} />
    </main>
  );
}
