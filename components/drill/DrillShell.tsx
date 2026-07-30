"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/ui/Header";
import { StatTile } from "@/components/ui/StatTile";
import { DrillTabs } from "@/components/drill/DrillTabs";
import { DrillPlayer } from "@/components/drill/DrillPlayer";
import { OpponentToggle, writeOppModeCookie } from "@/components/drill/OpponentToggle";
import { GENERATORS, pickMixedKind, type TabId } from "@/lib/drill/registry";
import { emptyWindows, nextLevel, pushResult, type DrillWindows } from "@/lib/drill/difficulty";
import { mulberry32 } from "@/lib/drill/rng";
import { fetchDrillState } from "@/lib/drill/drillState";
import {
  DRILL_KINDS,
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

type Levels = Partial<Record<DrillKind, DrillLevel>>;

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
      setWindows(seeded);
      setLevels((prev) => {
        const next = { ...prev };
        for (const kind of DRILL_KINDS) {
          next[kind] = nextLevel(seeded[kind], prev[kind] ?? 1);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Deal the next hand. Called only from event handlers. */
  const deal = useCallback(
    (forTab: TabId, mode: OppMode, lv: Levels) => {
      setLive(makeLive(forTab, mode, lv, seed, nextDealCount.current++));
    },
    [seed]
  );

  const handleSelectTab = useCallback(
    (next: TabId) => {
      setTab(next);
      deal(next, oppMode, levels);
    },
    [deal, oppMode, levels]
  );

  const handleMode = useCallback(
    (mode: OppMode) => {
      writeOppModeCookie(mode);
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
    </>
  );
}
