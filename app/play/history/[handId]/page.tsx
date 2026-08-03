import { SavedHandReview } from "@/components/play/PlayHistoryShell";

export const metadata = { title: "Hand review — PotLuck" };

export default async function SavedHandPage({
  params,
}: {
  params: Promise<{ handId: string }>;
}) {
  const { handId } = await params;
  return <SavedHandReview handId={handId} />;
}
