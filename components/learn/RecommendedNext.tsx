import Link from "next/link";
import { recommendationHref } from "../../lib/learn/path";
import type { Recommendation } from "../../lib/learn/types";

/**
 * The dashboard's "Recommended next" card, behind its own Suspense boundary.
 *
 * WHY THIS ONE CARD IS WORTH A BOUNDARY. `fetchServerRecommendation` issues
 * five Supabase queries — modules, lessons (including `content_json`),
 * progress, skill_stats and scenarios — and everything it produces lands in
 * this single card. Awaited in the page, those five queries sat in front of
 * the hero, the skill bars, the drill grid and the heatmap, none of which need
 * them. Now they hold up only the card they feed.
 *
 * It is a server component on purpose: the recommendation rule is shared with
 * `/learn` through `fetchServerRecommendation`, and moving this read to the
 * browser would either duplicate that rule or add a round trip to fetch it.
 * M8.8B keeps the recommendation singular; this only changes WHEN it renders.
 *
 * THE PROMISE IS A PROP, AND THAT IS THE POINT. The page starts the read and
 * hands over the pending promise rather than letting this component start it.
 * If this component called the fetcher itself, the five queries would not
 * begin until React reached this boundary — i.e. after the dashboard's own
 * stats read had resolved — turning two parallel reads into two sequential
 * ones. The page would paint sooner and finish later, which is a worse page
 * wearing the appearance of a faster one.
 */
export async function RecommendedNext({
  recommendation: pending,
}: {
  recommendation: Promise<Recommendation>;
}) {
  const recommendation = await pending;
  return (
    <div className="blueprint home-learn-next">
      <div>
        <div className="mono-label accent">Recommended next</div>
        <h3>
          {recommendation.lesson?.title ??
            (recommendation.type === "scenario"
              ? "Authored practice hand"
              : "Open the course map")}
        </h3>
        <p>{recommendation.reason}</p>
      </div>
      <Link href={recommendationHref(recommendation)} className="btn btn-primary blueprint btn-caps">
        Learn now
      </Link>
    </div>
  );
}

/**
 * The placeholder, in the same card at the same size.
 *
 * `.home-learning` is a three-column grid with `align-items: stretch`, so the
 * two static neighbours already fix the row height — the fallback only has to
 * occupy the first cell with the same classes to keep the grid geometry
 * identical. It carries a heading-sized line and a body line for the same
 * reason: a card that grows when the real content lands is a layout shift
 * arriving one beat after the page looked settled.
 */
export function RecommendedNextFallback() {
  return (
    <div className="blueprint home-learn-next" aria-busy="true" aria-live="polite">
      <div>
        <div className="mono-label accent">Recommended next</div>
        <h3 className="text-dim">Choosing your next lesson…</h3>
        <p>Reading your progress and the skill you are weakest in.</p>
      </div>
    </div>
  );
}
