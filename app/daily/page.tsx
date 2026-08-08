import type { Metadata } from "next";
import { DailyLoader } from "../../components/learn/DailyLoader";

export const metadata: Metadata = { title: "Daily lesson · PotLuck" };

/**
 * The shell renders on the server; the personalized item loads in the browser.
 *
 * This page used to await `/api/daily` during the server render by calling
 * this deployment's own public URL — see `components/learn/AsyncResource.tsx`
 * for why that hop is gone.
 */
export default function DailyPage() {
  return (
    <main className="page-narrow daily-page">
      <DailyLoader />
    </main>
  );
}
