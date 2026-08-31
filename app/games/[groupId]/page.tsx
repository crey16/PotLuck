import { GroupShell } from "@/components/games/GroupShell";

export const metadata = { title: "Group — PotLuck" };

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return (
    <main className="page page-narrow" style={{ paddingTop: "var(--space-8)" }}>
      <GroupShell groupId={groupId} />
    </main>
  );
}
