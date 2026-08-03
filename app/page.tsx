import Link from "next/link";
import { fetchDashboardStats } from "@/lib/drill/serverStats";
import {
  ActivityHeatmap,
  SkillRow,
  buildHeatmapWeeks,
} from "@/components/social/ProfileWidgets";
import { KIND_LABELS, TAB_ORDER, drillHref } from "@/lib/drill/registry";
import type { DrillKind } from "@/lib/drill/contract";
import { supabaseConfigured } from "@/lib/supabase/env";
import { fetchServerRecommendation } from "@/lib/learn/server";
import type { Recommendation } from "@/lib/learn/types";

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

function learningHref(recommendation: Recommendation): string {
  if (recommendation.type === "lesson" && recommendation.module_id && recommendation.lesson_id) {
    return `/learn/${recommendation.module_id}/${recommendation.lesson_id}`;
  }
  if (recommendation.type === "scenario") {
    const params = new URLSearchParams();
    if (recommendation.scenario_id) params.set("id", String(recommendation.scenario_id));
    if (recommendation.skill_tag) params.set("skill", recommendation.skill_tag);
    if (recommendation.difficulty) params.set("difficulty", String(recommendation.difficulty));
    return `/learn/practice${params.size ? `?${params}` : ""}`;
  }
  return "/learn";
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

  const [stats, learningRecommendation] = await Promise.all([
    fetchDashboardStats(),
    fetchServerRecommendation(),
  ]);
  const { profile } = stats;
  const level = profile?.level ?? 1;
  const xp = profile?.xp ?? 0;
  const xpToNext = level * 100 - xp;
  const xpPct = Math.min(100, Math.max(0, xp - (level - 1) * 100));
  const accuracy =
    stats.totalAttempts > 0 ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100) : null;

  const sinceLabel = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;

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

  // 12-week heatmap: columns are weeks (oldest → newest), rows Mon → Sun.
  const weeks = buildHeatmapWeeks(stats.activity);

  return (
    <main className="page" style={{ paddingTop: "var(--space-8)" }}>
      {/* — hero — */}
      <div className="home-hero">
        <div>
          <div className="mono-label accent" style={{ letterSpacing: ".14em", marginBottom: "var(--space-2)" }}>
            All time{sinceLabel ? ` · since ${sinceLabel}` : ""}
          </div>
          <h1 style={{ fontSize: 52, lineHeight: 0.95, margin: "0 0 var(--space-2)" }}>
            Level {level}
          </h1>
          <p
            style={{
              fontSize: 15, color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
              maxWidth: "44ch", margin: "0 0 var(--space-4)",
            }}
          >
            Every correct answer is 10&nbsp;XP, flat. 100&nbsp;XP a level — difficulty never
            inflates the rate.
          </p>
          <div
            style={{
              display: "flex", alignItems: "baseline", justifyContent: "space-between",
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "color-mix(in srgb, var(--color-text) 60%, transparent)", marginBottom: 5,
            }}
          >
            <span>{xp.toLocaleString()} XP total</span>
            <span>{xpToNext} XP to level {level + 1}</span>
          </div>
          <div className="meter">
            <i style={{ width: `${xpPct}%` }} />
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
            <Link
              href={learningHref(learningRecommendation)}
              className="btn btn-primary blueprint btn-caps"
              style={{ fontSize: 16, padding: "12px 22px" }}
            >
              Continue learning
            </Link>
            <Link
              href={drillHref("mixed")}
              className="btn btn-secondary btn-caps"
              style={{ fontSize: 15, padding: "12px 18px" }}
            >
              Mixed drill <span className="keyhint">D</span>
            </Link>
            {resumeKind && (
              <Link
                href={drillHref(resumeKind)}
                className="btn btn-secondary btn-caps"
                style={{ fontSize: 15, padding: "12px 18px" }}
              >
                Resume {KIND_LABELS[resumeKind].toLowerCase()}
              </Link>
            )}
          </div>
        </div>

        <div className="home-tiles">
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
            style={{ gridColumn: "span 2", display: "flex", gap: "var(--space-4)", alignItems: "center" }}
          >
            <div style={{ flex: 1 }}>
              <div className="mono-label" style={{ color: "var(--warn)" }}>Weakest skill</div>
              <div
                style={{
                  fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 24,
                  lineHeight: 1.1, marginTop: 2,
                }}
              >
                {weakest ? `${weakest.label} — ${weakest.accuracy}%` : "Not enough data yet"}
              </div>
              <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
                {weakest
                  ? `${weakest.attempts} answers. The app already picks this for recommendations.`
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
      </div>

      {/* — learning path — */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <div className="section-head">
          <h2>Learning path</h2>
          <span className="lede">Build the concept first; then use the drills to make it automatic.</span>
        </div>
        <div className="home-learning">
          <div className="blueprint home-learn-next">
            <div>
              <div className="mono-label accent">Recommended next</div>
              <h3>
                {learningRecommendation.lesson?.title ??
                  (learningRecommendation.type === "scenario" ? "Authored practice hand" : "Open the course map")}
              </h3>
              <p>{learningRecommendation.reason}</p>
            </div>
            <Link href={learningHref(learningRecommendation)} className="btn btn-primary blueprint btn-caps">
              Learn now
            </Link>
          </div>
          <Link href="/daily" className="blueprint home-daily">
            <div className="mono-label">Daily lesson</div>
            <strong>One focused decision</strong>
            <span>Changes at midnight ET · +15 XP</span>
            <b>Open daily →</b>
          </Link>
          <Link href="/learn" className="blueprint home-course-link">
            <div className="mono-label">Full course</div>
            <strong>5 modules · 20 lessons</strong>
            <span>Foundations through bankroll discipline</span>
            <b>View map →</b>
          </Link>
        </div>
      </section>

      {/* — skill strengths — */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <div className="section-head">
          <h2>Skill strengths</h2>
          <span className="lede">
            Eight tags, tracked on every answer. Bars are all-time accuracy; the count is sample size.
          </span>
        </div>
        {allSkills.length === 0 ? (
          <p className="text-dim">Answer a few hands and the eight skill tags appear here.</p>
        ) : (
          <>
            <div className="home-skills">
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
          <h2>The drills</h2>
          <span className="lede">
            Each drill carries its own difficulty, set by your last 10 answers in that drill.
          </span>
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

      {/* — activity + later — */}
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
              <span style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 25%, transparent)" }} />
              <span style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 50%, transparent)" }} />
              <span style={{ width: 13, height: 13, display: "inline-block", background: "color-mix(in srgb, var(--color-accent) 75%, transparent)" }} />
              <span style={{ width: 13, height: 13, display: "inline-block", background: "var(--color-accent)" }} />
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
            style={{
              border: "1px solid var(--color-divider)", padding: "var(--space-6)",
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
