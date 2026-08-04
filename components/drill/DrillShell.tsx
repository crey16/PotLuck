"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DrillPlayer } from "@/components/drill/DrillPlayer";
import { OpponentToggle, writeOppModeCookie } from "@/components/drill/OpponentToggle";
import { GENERATORS, KIND_LABELS, TAB_ORDER, drillHref, pickMixedKind, type TabId } from "@/lib/drill/registry";
import {
  emptyWindows,
  mergeSeededWindows,
  nextLevel,
  pushOutcome,
  seededLevels,
  type DrillWindows,
  type Levels,
} from "@/lib/drill/difficulty";
import { mulberry32 } from "@/lib/drill/rng";
import { generateFresh, pushSignature, questionSignature } from "@/lib/drill/antirepeat";
import { fetchDrillState } from "@/lib/drill/drillState";
import {
  responseTypeFor,
  type DrillKind, type DrillLevel, type DrillQuestion, type OppMode, type OptionValue,
} from "@/lib/drill/contract";
import { gradeAnswer } from "@/lib/drill/grade";
import { recordAttempt } from "@/lib/drill/recordAttempt";
import type { KindStat } from "@/lib/drill/serverStats";

const LEVEL_LABELS: Record<number, string> = {
  1: "Clean numbers",
  2: "Mixed sizings",
  3: "Awkward sizings",
};

/** The ten switchable drills — Reference is its own page in the redesign. */
type DrillTab = DrillKind | "mixed";
const DRILL_ORDER = TAB_ORDER.filter((t): t is DrillTab => t !== "reference");

export interface DrillShellProps {
  /** Initial tab from the ?tab= query string. */
  initialTab?: TabId;
  /** Opponent mode from the cookie, read server-side so SSR matches the client. */
  initialOppMode?: OppMode;
  /**
   * Seed for the first hand, generated server-side. Every hand is dealt from
   * `mulberry32(seed + dealCount)`, which means SSR and the client produce an
   * identical first question — no hydration mismatch and no mount effect — and
   * any hand is reproducible from (seed, dealCount).
   */
  seed: number;
  /** All-time per-kind aggregates, fetched server-side. */
  kindStats: Record<DrillKind, KindStat>;
}

interface Live {
  question: DrillQuestion;
  kind: DrillKind;
  difficulty: DrillLevel;
  dealCount: number;
}

/** Per-kind rolling windows of recently answered question signatures (M5). */
type RecentByKind = Partial<Record<DrillKind, readonly string[]>>;

/**
 * Pure deal: picks the kind for the tab, reads that kind's stored difficulty,
 * and generates from a seed derived from the deal count. No state writes, so it
 * is safe to call from a state initialiser and from event handlers alike.
 *
 * `recentByKind` is the anti-repeat memory: a colliding question is re-rolled
 * by continuing the same seeded rng stream, so the deal stays deterministic in
 * (seed, dealCount, window). The first deal always runs with an empty window —
 * on the server and on the client alike — so hydration still matches.
 */
function makeLive(
  tab: TabId,
  oppMode: OppMode,
  levels: Levels,
  seed: number,
  dealCount: number,
  recentByKind: RecentByKind
): Live | null {
  if (tab === "reference") return null;
  const rng = mulberry32(seed + dealCount);
  const kind = tab === "mixed" ? pickMixedKind(rng) : (tab as DrillKind);
  const generate = GENERATORS[kind];
  if (!generate) return null;
  const difficulty = levels[kind] ?? 1;
  const recent = new Set(recentByKind[kind] ?? []);
  return {
    question: generateFresh(generate, { level: difficulty, oppMode, rng }, recent),
    kind,
    difficulty,
    dealCount,
  };
}

export function DrillShell({
  initialTab = "mixed",
  initialOppMode = "unknown",
  seed,
  kindStats,
}: DrillShellProps) {
  const router = useRouter();
  const startTab: DrillTab = initialTab === "reference" ? "mixed" : (initialTab as DrillTab);
  const [tab, setTab] = useState<DrillTab>(startTab);
  const [oppMode, setOppMode] = useState<OppMode>(initialOppMode);
  const [windows, setWindows] = useState<DrillWindows>(() => emptyWindows());
  const [levels, setLevels] = useState<Levels>({});
  const [menuOpen, setMenuOpen] = useState(false);
  // All-time aggregates, advanced locally as the session adds answers so the
  // rail's footer and the drill menu stay honest without a refetch.
  const [stats, setStats] = useState(kindStats);
  // Dealt in a state initialiser, not an effect: makeLive is pure and seeded,
  // so the server and the client render the same first hand.
  const [live, setLive] = useState<Live | null>(() =>
    makeLive(initialTab, initialOppMode, {}, seed, 0, {})
  );

  const [right, setRight] = useState(0);
  const [total, setTotal] = useState(0);
  const [run, setRun] = useState(0);
  const [best, setBest] = useState(0);

  const nextDealCount = useRef(1);
  // Anti-repeat memory (M5): signatures of the questions answered this session,
  // per kind. A ref, not state — deals read it synchronously in event handlers
  // and nothing renders from it.
  const recentRef = useRef<RecentByKind>({});
  // Seeding is a first-paint restoration only. A kind the user has already
  // answered this session must keep its local window: the server snapshot
  // predates that answer, so applying it there would roll the answer back
  // while the session panel still shows it. Tracked per kind rather than as
  // one flag, because a single early answer must not discard the seed for
  // the other eight drills.
  const answeredKinds = useRef<Set<DrillKind>>(new Set());
  // The seeding effect runs once on mount but deals using whatever tab/mode is
  // current when it resolves. Refs rather than effect deps: adding them would
  // re-fetch history on every tab switch. Updated in the handlers below (the
  // only places these change) rather than during render, which React forbids.
  const tabRef = useRef<DrillTab>(startTab);
  const oppModeRef = useRef(initialOppMode);

  // Seed difficulty from history. This is the one legitimate exception to
  // "no useEffect that sets state" in this component: it reads from the
  // network after mount (session + fetch), which cannot happen during
  // render or in a state initialiser. Fails soft: no session, no network,
  // no problem — every window just stays empty and difficulty starts at 1.
  useEffect(() => {
    let cancelled = false;
    void fetchDrillState().then((seeded) => {
      if (cancelled || !seeded) return;
      const answered = answeredKinds.current;
      setWindows((local) => mergeSeededWindows(seeded, local, answered));
      setLevels((prev) => seededLevels(seeded, prev, answered));
      // Computed EAGERLY, outside the updater above, because the re-deal reads
      // it synchronously (see the sibling comment in the pre-redesign shell).
      const restored = seededLevels(seeded, {}, answered);
      if (answered.size === 0 && nextDealCount.current === 1) {
        setLive(
          makeLive(tabRef.current, oppModeRef.current, restored, seed, nextDealCount.current++, recentRef.current)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [seed]);

  /** Deal the next hand. Called only from event handlers. */
  const deal = useCallback(
    (forTab: TabId, mode: OppMode, lv: Levels) => {
      setLive(makeLive(forTab, mode, lv, seed, nextDealCount.current++, recentRef.current));
    },
    [seed]
  );

  const handleSelectTab = useCallback(
    (next: DrillTab) => {
      tabRef.current = next;
      setTab(next);
      setMenuOpen(false);
      deal(next, oppMode, levels);
      // Keep the address bar on the drill you are actually looking at, so a
      // refresh, bookmark or shared link comes back here rather than to Mixed.
      //
      // `history.replaceState`, not `router.push`: pushing re-runs the server
      // component, which mints a fresh per-request `seed`, and `seed` drives
      // the seeding effect and every deal. A tab switch would then refetch
      // drill-state and re-seed for no reason. This is the App Router's
      // supported shallow update — the URL changes, the RSC payload does not.
      window.history.replaceState(null, "", drillHref(next));
    },
    [deal, oppMode, levels]
  );

  const handleMode = useCallback(
    (mode: OppMode) => {
      writeOppModeCookie(mode);
      oppModeRef.current = mode;
      setOppMode(mode);
      // The dealt spot depends on the mode, so re-deal rather than relabel.
      deal(tab, mode, levels);
    },
    [deal, tab, levels]
  );

  const handleNext = useCallback(() => {
    deal(tab, oppMode, levels);
  }, [deal, tab, oppMode, levels]);

  const handleAnswered = useCallback(
    (chosen: OptionValue, ok: boolean) => {
      if (!live) return;
      const { kind, question } = live;
      // Recorded before any await so a seeding .then() resolving later sees it
      // and keeps this kind's local window instead of overwriting it.
      answeredKinds.current.add(kind);

      // Remember the answered question so the next deals avoid re-serving it.
      // Answer time, not deal time: the handler always runs before the next
      // deal, and a question abandoned via a tab switch is fine to see again.
      recentRef.current = {
        ...recentRef.current,
        [kind]: pushSignature(recentRef.current[kind] ?? [], questionSignature(question)),
      };

      // Difficulty is recomputed once per answer, from that kind's own window.
      // `pushOutcome`, not `pushResult`: an unsure answer leaves the window
      // alone so it can neither demote the drill nor be farmed for easier
      // questions. See lib/drill/difficulty.ts.
      const grade = gradeAnswer(question, chosen);
      const nextWindow = pushOutcome(windows[kind] ?? [], grade);
      setWindows((w) => ({ ...w, [kind]: nextWindow }));
      setLevels((prev) => ({ ...prev, [kind]: nextLevel(nextWindow, prev[kind] ?? 1) }));

      setStats((prev) => {
        const s = prev[kind];
        const attempts = s.attempts + 1;
        const correct = s.correct + (ok ? 1 : 0);
        return {
          ...prev,
          [kind]: { ...s, attempts, correct, accuracy: Math.round((correct / attempts) * 100) },
        };
      });

      setTotal((t) => t + 1);
      if (ok) {
        setRight((r) => r + 1);
        const nextRun = run + 1;
        setRun(nextRun);
        setBest((b) => Math.max(b, nextRun));
      } else {
        setRun(0);
      }

      // The layout header owns XP/streak display now; the write still has to
      // land, but there is nothing to show from the response.
      void recordAttempt({
        kind,
        payload: question.payload,
        answer: chosen,
        correct: ok,
        responseType: responseTypeFor(chosen),
      });
    },
    [live, windows, run]
  );

  // Shell-level shortcuts: R opens the reference, D jumps to the mixed drill.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (key === "R") {
        e.preventDefault();
        router.push(live ? `/reference?from=${live.kind}` : "/reference");
      } else if (key === "D" && tab !== "mixed") {
        e.preventDefault();
        handleSelectTab("mixed");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, tab, live, handleSelectTab]);

  const sessionAccuracy = total === 0 ? null : Math.round((right / total) * 100);
  const difficulty = live?.difficulty ?? 1;
  const drillIndex = DRILL_ORDER.indexOf(tab);
  const prevTab = DRILL_ORDER[(drillIndex - 1 + DRILL_ORDER.length) % DRILL_ORDER.length];
  const nextTab = DRILL_ORDER[(drillIndex + 1) % DRILL_ORDER.length];
  const tabLabel = tab === "mixed" ? "Mixed drill" : KIND_LABELS[tab as DrillKind];

  // The rail footer: this drill's all-time line (or every drill for Mixed).
  const allTime = (() => {
    if (tab === "mixed") {
      const list = Object.values(stats);
      const attempts = list.reduce((a, s) => a + s.attempts, 0);
      const correct = list.reduce((a, s) => a + s.correct, 0);
      return {
        label: "All time · all drills",
        value: attempts > 0 ? `${Math.round((correct / attempts) * 100)}% / ${attempts}` : "— / 0",
      };
    }
    const s = stats[tab as DrillKind];
    return {
      label: `All time · ${tabLabel.toLowerCase()}`,
      value: s.attempts > 0 ? `${s.accuracy}% / ${s.attempts}` : "— / 0",
    };
  })();

  return (
    <main className="page">
      {/* — drill switcher — */}
      <div className="switcher">
        <div className="left">
          <button className="stepbtn" title="Previous drill" onClick={() => handleSelectTab(prevTab)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button className="stepbtn" title="Next drill" onClick={() => handleSelectTab(nextTab)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="mono-label accent" style={{ letterSpacing: ".12em" }}>
              DRILL {String(drillIndex + 1).padStart(2, "0")} / {DRILL_ORDER.length}
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 24,
                lineHeight: 1.05, letterSpacing: ".02em", textTransform: "uppercase",
              }}
            >
              {tabLabel}
            </span>
          </div>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              border: "1px solid var(--color-divider)", background: "transparent",
              color: "var(--color-text)", padding: "6px 10px", cursor: "pointer",
              fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13,
              letterSpacing: ".04em", textTransform: "uppercase",
            }}
          >
            All drills
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
        <div className="right">
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="mono-label" style={{ fontSize: 9.5, letterSpacing: ".1em" }}>Opponent</span>
            <OpponentToggle mode={oppMode} onChange={handleMode} />
          </div>
          <button
            className="btn-outline-accent"
            onClick={() => router.push(live ? `/reference?from=${live.kind}` : "/reference")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Stuck? Reference
            <span className="keyhint">R</span>
          </button>
        </div>

        {menuOpen && (
          <div className="drill-menu">
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-3)" }}>
              Pick a drill — accuracy and level are yours, all time
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "1px var(--space-4)" }}>
              {DRILL_ORDER.map((t, i) => {
                const s = t === "mixed" ? null : stats[t as DrillKind];
                const lv = t === "mixed" ? null : (levels[t as DrillKind] ?? s!.level);
                return (
                  <button
                    key={t}
                    className={`drill-menu-item${t === tab ? " current" : ""}`}
                    onClick={() => handleSelectTab(t)}
                  >
                    <span className="nn">{String(i + 1).padStart(2, "0")}</span>
                    <span className="nm">{t === "mixed" ? "Mixed drill" : KIND_LABELS[t as DrillKind]}</span>
                    <span className="st">{s && s.attempts > 0 ? `${s.accuracy}%` : "—"}</span>
                    {lv !== null && <span className="lv">L{lv}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* — question + rail — */}
      <div className="drill-layout">
        <div>
          <div className="blueprint" style={{ padding: "var(--space-6)" }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: "var(--space-3)",
                flexWrap: "wrap", marginBottom: "var(--space-3)",
              }}
            >
              <span className="mono-label accent" style={{ letterSpacing: ".14em" }}>
                {live?.question.kicker ?? tabLabel}
              </span>
              {live?.question.chip && <span className="tag tag-neutral tag-mono">{live.question.chip}</span>}
              <span className="tag tag-accent tag-mono">Level {difficulty} of 3</span>
              {oppMode === "shown" && <span className="tag tag-outline tag-mono">Opponent face-up</span>}
              <span className="mono-label" style={{ marginLeft: "auto", letterSpacing: ".08em" }}>
                Hand {total + 1}
              </span>
            </div>
            {live && (
              // Keyed on the deal: a new hand remounts the player, which resets
              // its chosen-answer state without an effect.
              <DrillPlayer
                key={live.dealCount}
                question={live.question}
                run={run}
                onAnswered={handleAnswered}
                onNext={handleNext}
              />
            )}
          </div>
        </div>

        <aside className="drill-rail">
          <div className="session-box">
            <div className="head">
              <span>This session</span>
              <span>resets on reload</span>
            </div>
            <div className="cells">
              <div className="cell" style={{ borderRight: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
                <div className="k">Answered</div>
                <div className="v">{total}</div>
              </div>
              <div className="cell" style={{ borderBottom: "1px solid var(--color-divider)" }}>
                <div className="k">Session accuracy</div>
                <div className="v">{sessionAccuracy !== null ? `${sessionAccuracy}%` : "—"}</div>
              </div>
              <div className="cell" style={{ borderRight: "1px solid var(--color-divider)" }}>
                <div className="k">Current run</div>
                <div className="v">
                  {run}{" "}
                  <span style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                    best {best}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                  correct in a row
                </div>
              </div>
              <div className="cell">
                <div className="k">Session XP</div>
                <div className="v">+{right * 10}</div>
              </div>
            </div>
            <div className="foot">
              <span>{allTime.label}</span>
              <span>{allTime.value}</span>
            </div>
          </div>

          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
              <span className="mono-label" style={{ letterSpacing: ".12em" }}>Difficulty</span>
              <div className="pips wide">
                {[1, 2, 3].map((i) => (
                  <span key={i} className={i <= difficulty ? "on" : undefined} />
                ))}
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 20,
                letterSpacing: "-.005em", lineHeight: 1.1,
              }}
            >
              Level {difficulty} — {LEVEL_LABELS[difficulty].toLowerCase()}
            </div>
            <p style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)", margin: "6px 0 var(--space-3)" }}>
              Each drill keeps its own level, set by your last 10 answers <b>in this drill</b>.
            </p>
            <div
              style={{
                display: "flex", flexDirection: "column", gap: 5, fontSize: 12,
                borderTop: "1px solid var(--color-divider)", paddingTop: "var(--space-2)",
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-700)" }}>L1</span>
                <span>Round pots, half and full pot bets</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-700)" }}>L2</span>
                <span>Mixed sizings, ⅓ to 1¼ pot</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-700)" }}>L3</span>
                <span>Awkward numbers, raises, dead money</span>
              </div>
            </div>
          </div>

          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-3)" }}>
              Keyboard
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">1</span>
                <span className="keycap">4</span>
                pick an answer
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">0</span>
                not sure
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">N</span>
                <span className="keycap">Enter</span>
                next hand
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">R</span>
                reference
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">D</span>
                mixed drill
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
