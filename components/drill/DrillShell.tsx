"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/ui/Header";
import { StatTile } from "@/components/ui/StatTile";
import { DrillTabs } from "@/components/drill/DrillTabs";
import { DrillPlayer } from "@/components/drill/DrillPlayer";
import { OpponentToggle, writeOppModeCookie } from "@/components/drill/OpponentToggle";
import { ReferenceTab } from "@/components/drill/ReferenceTab";
import { GENERATORS, pickMixedKind, type TabId } from "@/lib/drill/registry";
import {
  emptyWindows,
  mergeSeededWindows,
  nextLevel,
  pushResult,
  seededLevels,
  type DrillWindows,
  type Levels,
} from "@/lib/drill/difficulty";
import { mulberry32 } from "@/lib/drill/rng";
import { fetchDrillState } from "@/lib/drill/drillState";
import {
  type DrillKind, type DrillLevel, type DrillQuestion, type OppMode, type OptionValue,
} from "@/lib/drill/contract";
import { recordAttempt } from "@/lib/drill/recordAttempt";

export interface Profile {
  username: string;
  xp: number;
  level: number;
  streak_count: number;
}

export interface DrillShellProps {
  profile: Profile | null;
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
}

interface Live {
  question: DrillQuestion;
  kind: DrillKind;
  difficulty: DrillLevel;
  dealCount: number;
}

/**
 * Pure deal: picks the kind for the tab, reads that kind's stored difficulty,
 * and generates from a seed derived from the deal count. No state writes, so it
 * is safe to call from a state initialiser and from event handlers alike.
 */
function makeLive(
  tab: TabId,
  oppMode: OppMode,
  levels: Levels,
  seed: number,
  dealCount: number
): Live | null {
  if (tab === "reference") return null;
  const rng = mulberry32(seed + dealCount);
  const kind = tab === "mixed" ? pickMixedKind(rng) : (tab as DrillKind);
  const generate = GENERATORS[kind];
  if (!generate) return null;
  const difficulty = levels[kind] ?? 1;
  return {
    question: generate({ level: difficulty, oppMode, rng }),
    kind,
    difficulty,
    dealCount,
  };
}

export function DrillShell({
  profile: initialProfile,
  initialTab = "mixed",
  initialOppMode = "unknown",
  seed,
}: DrillShellProps) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [oppMode, setOppMode] = useState<OppMode>(initialOppMode);
  const [windows, setWindows] = useState<DrillWindows>(() => emptyWindows());
  const [levels, setLevels] = useState<Levels>({});
  // Dealt in a state initialiser, not an effect: makeLive is pure and seeded,
  // so the server and the client render the same first hand.
  const [live, setLive] = useState<Live | null>(() =>
    makeLive(initialTab, initialOppMode, {}, seed, 0)
  );

  const [score, setScore] = useState(0);
  const [right, setRight] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);

  const latestRequestId = useRef(0);
  const nextDealCount = useRef(1);
  // Seeding is a first-paint restoration only. A kind the user has already
  // answered this session must keep its local window: the server snapshot
  // predates that answer, so applying it there would roll the answer back
  // while Score and XP still show it — an invisible loss. Tracked per kind
  // rather than as one flag, because a single early answer must not discard
  // the seed for the other eight drills.
  const answeredKinds = useRef<Set<DrillKind>>(new Set());
  // The seeding effect runs once on mount but deals using whatever tab/mode is
  // current when it resolves. Refs rather than effect deps: adding them would
  // re-fetch history on every tab switch. Updated in the handlers below (the
  // only places these change) rather than during render, which React forbids.
  const tabRef = useRef(initialTab);
  const oppModeRef = useRef(initialOppMode);

  // Seed difficulty from history. This is the one legitimate exception to
  // "no useEffect that sets state" in this component: it reads from the
  // network after mount (session + fetch), which cannot happen during
  // render or in a state initialiser. Fails soft: no session, no network,
  // no problem — every window just stays empty and difficulty starts at 1.
  // (No eslint-disable needed: react-hooks/set-state-in-effect does not
  // flag state set from inside an async callback/.then(), only synchronous
  // sets in the effect body — confirmed by `npm run lint` passing clean.)
  useEffect(() => {
    let cancelled = false;
    void fetchDrillState().then((seeded) => {
      if (cancelled || !seeded) return;
      const answered = answeredKinds.current;
      setWindows((local) => mergeSeededWindows(seeded, local, answered));
      setLevels((prev) => seededLevels(seeded, prev, answered));
      // Computed EAGERLY, outside the updater above, because the re-deal reads
      // it synchronously. Assembling it inside the updater meant React had not
      // run the updater yet when the re-deal fired, so it dealt from an empty
      // object — every page load opened at level 1 regardless of history, and
      // only corrected itself on the first tab switch.
      //
      // Passing `{}` as the previous levels is exact, not an approximation:
      // the re-deal below only runs when nothing has been answered, and with
      // no answered kinds `seededLevels` never consults them.
      const restored = seededLevels(seeded, {}, answered);
      // The first hand was dealt in the state initialiser, before any history
      // existed, so it is always a level-1 hand and the Difficulty tile reads
      // 1 — even for a level-3 user. Re-deal once, so restored difficulty
      // applies to the hand actually on screen rather than the next one. Only
      // safe while nothing has been answered: re-dealing under the user would
      // discard a question they were mid-way through.
      if (answered.size === 0 && nextDealCount.current === 1) {
        setLive(makeLive(tabRef.current, oppModeRef.current, restored, seed, nextDealCount.current++));
      }
    });
    return () => {
      cancelled = true;
    };
    // `seed` is a prop fixed for the lifetime of this page load (one seed per
    // request), so this still runs exactly once — listing it just keeps the
    // dependency honest rather than suppressing the lint rule.
  }, [seed]);

  /** Deal the next hand. Called only from event handlers. */
  const deal = useCallback(
    (forTab: TabId, mode: OppMode, lv: Levels) => {
      setLive(makeLive(forTab, mode, lv, seed, nextDealCount.current++));
    },
    [seed]
  );

  const handleSelectTab = useCallback(
    (next: TabId) => {
      tabRef.current = next;
      setTab(next);
      deal(next, oppMode, levels);
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
      const { kind, difficulty, question } = live;
      // Recorded before any await so a seeding .then() resolving later sees it
      // and keeps this kind's local window instead of overwriting it.
      answeredKinds.current.add(kind);

      // Difficulty is recomputed once per answer, from that kind's own window.
      const nextWindow = pushResult(windows[kind] ?? [], ok);
      setWindows((w) => ({ ...w, [kind]: nextWindow }));
      setLevels((prev) => ({ ...prev, [kind]: nextLevel(nextWindow, prev[kind] ?? 1) }));

      setTotal((t) => t + 1);
      if (ok) {
        setRight((r) => r + 1);
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        setBest((b) => Math.max(b, nextStreak));
        // Session score only — never persisted XP, which stays flat at 10 per
        // correct answer server-side so difficulty can't be farmed for rank.
        setScore((s) => s + 10 * difficulty + Math.min(20, (nextStreak - 1) * 2));
      } else {
        setStreak(0);
      }

      const requestId = ++latestRequestId.current;
      void recordAttempt({ kind, payload: question.payload, answer: chosen, correct: ok }).then(
        (update) => {
          if (!update || requestId !== latestRequestId.current) return;
          setProfile({
            username: update.username,
            xp: update.xp,
            level: update.level,
            streak_count: update.streak_count,
          });
        }
      );
    },
    [live, windows, streak]
  );

  const accuracy = total === 0 ? 0 : Math.round((right / total) * 100);
  const difficulty = live?.difficulty ?? 1;

  return (
    <>
      <Header
        username={profile?.username}
        xp={profile?.xp}
        level={profile?.level}
        streak={profile?.streak_count}
      />

      <DrillTabs active={tab} onSelect={handleSelectTab} />

      <div className="stats">
        <StatTile
          label="Score"
          value={score}
          sub={total ? `${right} of ${total} correct` : "answer to earn points"}
        />
        <StatTile label="Accuracy" value={total ? `${accuracy}%` : "—"} meterPercent={accuracy} />
        <StatTile label="Streak" value={streak} sub={`best ${best}`} />
        <StatTile label="Difficulty" value={difficulty} pips={difficulty} />
      </div>

      {tab === "reference" ? (
        <div className="panel">
          <ReferenceTab />
        </div>
      ) : (
        <div className="panel">
          <div className="qhead">
            <span className="kicker">{live?.question.kicker ?? ""}</span>
            {live?.question.chip && <span className="chip">{live.question.chip}</span>}
            <span className="chip">Level {difficulty}</span>
            <OpponentToggle mode={oppMode} onChange={handleMode} />
          </div>
          {live && (
            // Keyed on the deal: a new hand remounts the player, which resets its
            // chosen-answer state without an effect.
            <DrillPlayer
              key={live.dealCount}
              question={live.question}
              onAnswered={handleAnswered}
              onNext={handleNext}
            />
          )}
        </div>
      )}
    </>
  );
}
