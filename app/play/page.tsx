import { PlayShell } from "@/components/play/PlayShell";

export const metadata = { title: "Play — PotLuck" };

export default function PlayPage() {
  // One seed per page load, exactly like /drill: per-request randomness is
  // the intent (see the note in app/drill/page.tsx).
  // eslint-disable-next-line react-hooks/purity
  const seed = Math.floor(Math.random() * 2 ** 31);
  return <PlayShell seed={seed} />;
}
