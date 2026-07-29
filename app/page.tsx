import { Header } from "@/components/ui/Header";

export default function Home() {
  return (
    <div className="wrap">
      <Header />
      <div className="panel">
        <div className="prompt">Design system port</div>
        <p className="sub">
          Tokens and UI primitives are in place. Real routing and drills land
          in the next task.
        </p>
      </div>
    </div>
  );
}
