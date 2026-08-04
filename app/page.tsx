import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchDashboardStats } from "@/lib/drill/serverStats";
import { fetchPlacementRouting } from "@/lib/placement/server";
import {
  ActivityHeatmap,
  SkillRow,
  buildHeatmapWeeks,
} from "@/components/social/ProfileWidgets";
import { ContinuePath } from "@/components/learn/ContinuePath";
import { CourseMap } from "@/components/learn/CourseMap";
import { KIND_LABELS, TAB_ORDER, drillHref } from "@/lib/drill/registry";
import type { DrillKind } from "@/lib/drill/contract";
import { supabaseConfigured } from "@/lib/supabase/env";
import { fetchLearningPath, fetchServerRecommendation } from "@/lib/learn/server";
import { nextPathStep, pathProgress, recommendationHref } from "@/lib/learn/path";

/** Card blurbs, from the redesign spec. */
const DRILL_DESCRIPTIONS: Record<DrillKind | "mixed", string> = {
  mixed: "Deals from all nine kinds; each answer counts toward that kind",
  outs: "Cards that complete your draw, dead outs stripped",
  rule24: "Turn outs into equity in your head",
  potodds: "The equity a call needs to break even",
  decision: "Price against equity, one decision",
  implied: "What you must win later to justify the call",
  ev: "EV of a call in dollars",
  bluff: "Folds a bluff needs, and MDF",
  concepts: "Spot the old-man-coffee leak",
  preflop: "6-max reference ranges, 169 cells",
};

const LEVEL_LABELS: Record<number, string> = {
  1: "Clean numbers",
  2: "Mixed sizings",
  3: "Awkward sizings",
};

/** Weakest-skill routing: the drill that trains each tag. */
const TAG_TO_KIND: Record<string, DrillKind> = {
  pot_odds: "potodds",
  bluffing: "bluff",
  discipline: "concepts",
  hand_selection: "preflop",
  counting_outs: "outs",
  equity_estimation: "rule24",
  implied_odds: "implied",
  expected_value: "ev",
};

function easternDaypart(now = new Date()): "morning" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  );
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function streakSentence(level: number, streak: number): string {
  if (streak <= 0) return `You are level ${level}.`;
  if (streak === 1) return `You are level ${level} and one day into a streak.`;
  return `You are level ${level} and ${streak} days into a streak.`;
}

function Pips({ level }: { level: number }) {
  return (
    <div className="pips" style={{ justifyContent: "flex-end", marginBottom: 4 }}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? "on" : undefined} />
      ))}
    </div>
  );
}

/**
 * The signed-in landing surface (M8.5A).
 *
 * The training loop is lesson-first: a signed-in player lands on their
 * lessons, not on a statistics dashboard. The next lesson, current module and
 * path progress are the primary content; streak, XP, skill rows and drill
 * cards live below under "Your progress", and the deterministic
 * recommendation is a secondary "recommended practice" slot that must never
 * displace the path as the main action.
 *
 * The logged-out route below is unchanged — this reorder is authenticated-only.
 * The module list itself is `components/learn/CourseMap`, shared with `/learn`;
 * there is no second copy here.
 */
export default async function Home() {
  if (!supabaseConfigured()) {
    return (
      <main className="page">
        <div className="mono-label accent" style={{ marginBottom: "var(--space-3)" }}>
          Poker math trainer
        </div>
        <h1 style={{ fontSize: 52, lineHeight: 0.95 }}>Learn the numbers until they are automatic.</h1>
        <p className="text-dim" style={{ maxWidth: "52ch" }}>
          Supabase is not configured — add <code>.env.local</code> to enable accounts.{" "}
          <Link href="/drill">The drills still work without one</Link>.
        </p>
      </main>
    );
  }

  // M8.5B: a brand-new account is placed before it is taught. Checked before
  // anything else is rendered so the path is never presented first, and it is
  // a one-time redirect — starting, completing or skipping the assessment all
  // write a row, after which this is false forever.
  if ((await fetchPlacementRouting()).needsPlacement) redirect("/placement");

  const [stats, path, learningRecommendation] = await Promise.all([
    fetchDashboardStats(),
    fetchLearningPath(),
    fetchServerRecommendation(),
  ]);
  const { profile } = stats;
  const level = profile?.level ?? 1;
  const xp = profile?.xp ?? 0;
  const xpToNext = level * 100 - xp;
  const xpPct = Math.min(100, Math.max(0, xp - (level - 1) * 100));
  const accuracy =
    stats.totalAttempts > 0 ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100) : null;

  const progress = pathProgress(path);
  const step = nextPathStep(path);

  // Weakest skill: lowest accuracy among tags with ≥5 attempts — the same
  // rule the recommendation engine uses.
  const ranked = [...stats.skills].filter((s) => s.attempts >= 5).sort((a, b) => a.accuracy - b.accuracy);
  const weakest = ranked[0] ?? null;
  const weakestKind = weakest ? TAG_TO_KIND[weakest.tag] : null;

  // All 8 tags, best first, zero-attempt tags at the end.
  const allSkills = [...stats.skills].sort((a, b) => b.accuracy - a.accuracy);

  const drillOrder = TAB_ORDER.filter((t) => t !== "reference");
  const kindLevels = Object.values(stats.kinds).filter((k) => k.attempts > 0).map((k) => k.level);
  const mixedLevel = kindLevels.length
    ? Math.round(kindLevels.reduce((a, b) => a + b, 0) / kindLevels.length)
    : 1;

  const resumeKind = stats.lastKind;
  const firstName = (profile?.displayName?.trim() || profile?.username || "there").split(/\s+/)[0];

  // 12-week heatmap: columns are weeks (oldest → newest), rows Mon → Sun.
  const weeks = buildHeatmapWeeks(stats.activity);

  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      {/* — the path, first — */}
      <div className="home-path-hero">
        <div>
          <h1 style={{ fontSize: 46, lineHeight: 1, margin: "0 0 6px", letterSpacing: "-.02em" }}>
            Good {easternDaypart()}, {firstName}.
          </h1>
          <p
            style={{
              fontSize: 16, color: "color-mix(in srgb, var(--color-text) 62%, transparent)",
              maxWidth: "46ch", margin: "0 0 var(--space-6)",
            }}
          >
            {streakSentence(level, profile?.streak ?? 0)}{" "}
            {step
              ? "Pick the path back up where you left it."
              : "The course is finished — keep the numbers sharp in the drill room."}
          </p>

          <div className="home-path-side">
            {learningRecommendation.type !== "none" && (
              <section className="blueprint recommended-practice">
                <div>
                  <div className="mono-label">Recommended practice</div>
                  <strong>
                    {learningRecommendation.lesson?.title ??
                      (learningRecommendation.type === "scenario"
                        ? "Authored practice hand"
                        : "Course map")}
                  </strong>
                  <span>{learningRecommendation.reason}</span>
                </div>
                <Link
                  href={recommendationHref(learningRecommendation)}
                  className="btn btn-secondary btn-caps"
                >
                  Practice this
                </Link>
              </section>
            )}
            <Link href="/daily" className="blueprint home-daily">
              <div className="mono-label">Daily lesson</div>
              <strong>One focused decision</strong>
              <span>Changes at midnight ET · +15 XP</span>
              <b>Open daily →</b>
            </Link>
          </div>
        </div>

        <ContinuePath step={step} progress={progress} />
      </div>

      {/* — course map — */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <div className="section-head">
          <h2>Your course</h2>
          <span className="lede">
            Five modules, in order. Nothing is gated — revisit any lesson at any time.{" "}
            <Link href="/learn">Open the full course map</Link>.
          </span>
        </div>
        {path.error && <div className="note critl" role="alert">{path.error}</div>}
        {!path.error && path.modules.length === 0 ? (
          <p className="text-dim">
            No lessons are loaded yet. Apply <code>supabase/seed.sql</code> to seed the course.
          </p>
        ) : (
          <CourseMap modules={path.modules} completedLessonIds={path.completedLessonIds} />
        )}
      </section>

      {/* — progress: everything that used to lead the page — */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <div className="section-head">
          <h2>Your progress</h2>
          <span className="lede">Level, streak, and the eight skill tags tracked on every answer.</span>
        </div>

        <div className="home-tiles home-progress-tiles">
          <div className="blueprint stat-tile">
            <div className="mono-label">Level {level}</div>
            <div className="big">
              {xp.toLocaleString()}{" "}
              <span style={{ fontSize: 15, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                XP
              </span>
            </div>
            <div className="meter" style={{ margin: "6px 0" }}>
              <i style={{ width: `${xpPct}%` }} />
            </div>
            <div className="small">{xpToNext} XP to level {level + 1}</div>
          </div>
          <div className="blueprint stat-tile">
            <div className="mono-label">Day streak</div>
            <div className="big">
              {profile?.streak ?? 0}{" "}
              <span style={{ fontSize: 15, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                days
              </span>
            </div>
            <div className="small">Days played in a row. Answer once today to keep it.</div>
          </div>
          <div className="blueprint stat-tile">
            <div className="mono-label">All-time accuracy</div>
            <div className="big">
              {accuracy !== null ? (
                <>
                  {accuracy}
                  <span style={{ fontSize: 22 }}>%</span>
                </>
              ) : (
                "—"
              )}
            </div>
            <div className="small">
              {stats.totalAttempts > 0
                ? `${stats.totalCorrect} correct of ${stats.totalAttempts} answers`
                : "No answers yet"}
            </div>
          </div>
          <div
            className="blueprint stat-tile"
            style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}
          >
            <div style={{ flex: 1 }}>
              <div className="mono-label" style={{ color: "var(--warn)" }}>Weakest skill</div>
              <div
                style={{
                  fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 22,
                  lineHeight: 1.1, marginTop: 2,
                }}
              >
                {weakest ? `${weakest.label} — ${weakest.accuracy}%` : "Not enough data yet"}
              </div>
              <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
                {weakest
                  ? `${weakest.attempts} answers.`
                  : "Five answers on a skill puts it on the board."}
              </div>
            </div>
            <Link
              href={drillHref(weakestKind ?? "mixed")}
              className="btn btn-secondary btn-caps"
              style={{ whiteSpace: "nowrap" }}
            >
              Drill it
            </Link>
          </div>
        </div>

        {allSkills.length === 0 ? (
          <p className="text-dim" style={{ marginTop: "var(--space-6)" }}>
            Answer a few hands and the eight skill tags appear here.
          </p>
        ) : (
          <>
            <div className="home-skills" style={{ marginTop: "var(--space-6)" }}>
              {allSkills.map((s) => (
                <SkillRow key={s.tag} skill={s} weak={weakest !== null && s.tag === weakest.tag} />
              ))}
            </div>
            {weakest && (
              <div
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".08em",
                  textTransform: "uppercase", color: "var(--warn)", marginTop: "var(--space-3)",
                  display: "flex", alignItems: "center", gap: 7,
                }}
              >
                <span className="hatch" style={{ width: 16, height: 10, border: "1px solid var(--warn)", display: "inline-block" }} />
                Hatched + flagged = weakest tag, not colour alone
              </div>
            )}
          </>
        )}
      </section>

      {/* — the drills — */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <div className="section-head">
          <h2>Sharpen it in the drill room</h2>
          <span className="lede">
            Each drill carries its own difficulty, set by your last 10 answers in that drill.
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-6)", flexWrap: "wrap" }}>
          <Link href={drillHref("mixed")} className="btn btn-secondary btn-caps">
            Start mixed drill <span className="keyhint">D</span>
          </Link>
          {resumeKind && (
            <Link href={drillHref(resumeKind)} className="btn btn-secondary btn-caps">
              Resume {KIND_LABELS[resumeKind].toLowerCase()}
            </Link>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: "var(--space-4)" }}>
          {drillOrder.map((t, i) => {
            const isMixed = t === "mixed";
            const stat = isMixed ? null : stats.kinds[t as DrillKind];
            const answers = isMixed ? stats.totalAttempts : stat!.attempts;
            const acc = isMixed ? accuracy : stat!.accuracy;
            const lvl = isMixed ? mixedLevel : stat!.level;
            return (
              <Link key={t} href={drillHref(t)} className="blueprint drill-card">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span className="mono-label accent" style={{ letterSpacing: ".12em" }}>
                    DRILL {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="mono-label" style={{ letterSpacing: ".08em" }}>
                    {answers > 0 ? `${answers} ANSWERS` : "NEW"}
                  </span>
                </div>
                <div className="title">{isMixed ? "Mixed drill" : KIND_LABELS[t as DrillKind]}</div>
                <div className="desc">{DRILL_DESCRIPTIONS[t as DrillKind | "mixed"]}</div>
                <div
                  style={{
                    display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                    gap: "var(--space-3)", marginTop: "auto",
                  }}
                >
                  <div>
                    <div className="acc">
                      {acc !== null && answers > 0 ? (
                        <>
                          {acc}
                          <span style={{ fontSize: 15 }}>%</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                    <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: ".1em" }}>
                      accuracy
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Pips level={lvl} />
                    <div className="mono-label" style={{ fontSize: 9.5, letterSpacing: ".08em" }}>
                      lvl {lvl} · {LEVEL_LABELS[lvl]}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* — activity + social — */}
      <section className="home-bottom">
        <div>
          <div className="section-head">
            <h2>Activity</h2>
            <span className="lede">XP earned per day, last 12 weeks.</span>
          </div>
          <ActivityHeatmap weeks={weeks} />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
              }}
            >
              none
              <span className="heat-cell empty" style={{ width: 13, height: 13, display: "inline-block" }} />
              <span className="heat-cell" style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 25%, transparent)" }} />
              <span className="heat-cell" style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 50%, transparent)" }} />
              <span className="heat-cell" style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 75%, transparent)" }} />
              <span className="heat-cell" style={{ width: 13, height: 13, display: "inline-block", background: "var(--color-accent)" }} />
              120+ xp
            </div>
            {(profile?.streak ?? 0) > 0 && (
              <div
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
                  textTransform: "uppercase", color: "var(--color-accent-700)",
                }}
              >
                last {profile!.streak} day{profile!.streak === 1 ? "" : "s"} played — streak live
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-head" style={{ gap: 0 }}>
            <h2>Social</h2>
          </div>
          <div
            className="blueprint"
            style={{
              padding: "var(--space-6)",
              display: "flex", flexDirection: "column", gap: "var(--space-2)",
            }}
          >
            <div className="mono-label" style={{ fontSize: 10, letterSpacing: ".12em" }}>Live</div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 20, lineHeight: 1.15 }}>
              Friends · leaderboards
            </div>
            <p style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)", margin: 0 }}>
              Add friends by username, compare skill profiles, and watch the
              XP and streak boards move live. Head-to-head challenges are next.
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              <Link href="/friends" className="btn btn-secondary btn-caps">Friends</Link>
              <Link href="/leaderboard" className="btn btn-secondary btn-caps">Ranks</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
