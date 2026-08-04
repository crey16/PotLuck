"use client";

/**
 * The M6 play mode: full hands against the solver, street by street, graded
 * per decision by EV loss — GTO Wizard's practice drill, on PotLuck's data.
 *
 * All game logic lives in lib/play (pure, tested); this component is the
 * session shell: load a scripted instance, walk its timeline, collect the
 * hero's choices, persist server-graded decisions, and keep page stats.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoneyStrip } from "@/components/ui/MoneyStrip";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";
import { ActionBar } from "./ActionBar";
import { PokerTable } from "./PokerTable";
import { VerdictFlash } from "./VerdictFlash";
import { useHandDirector } from "./useHandDirector";
import { beatsFor } from "@/lib/play/beats";
import { actionLabelBb } from "@/lib/play/labels";
import { mulberry32 } from "@/lib/drill/rng";
import { whoIsAhead, type Card } from "@/lib/poker/engine";
import {
  buildPlayDecisionBody,
  createPlayDecision,
  createPlayHand,
  createPlaySession,
  newPlayClientId,
  updatePlayHand,
  type PlayApiError,
  type PlayDecisionReview,
  type PlayHandSummary,
  type PlaySession,
} from "@/lib/play/api";
import { fetchManifest, fetchSolve, handId, pickHand, SPOT } from "@/lib/play/load";
import { parseAction } from "@/lib/play/actions";
import { bb, signedBb } from "@/lib/play/units";
import { preflopDecision, type PreflopDecision } from "@/lib/play/preflop";
import {
  awaitingHero, boardFrom, handOver, holeCards, potAfter, timeline, toCallAt,
  type HandEvent,
} from "@/lib/play/timeline";
import {
  isRightVerdict, lossDollars, verdictAt, type Verdict,
} from "@/lib/play/verdict";
import type { PlayInstance, SolveFile, SolveManifest } from "@/lib/play/types";

const VERDICT_WORD: Record<Verdict, string> = {
  correct: "Correct",
  acceptable: "Also fine",
  inaccuracy: "Inaccuracy",
  blunder: "Blunder",
};

const STREET_NAME = ["Flop", "Turn", "River"] as const;

/** Hero's own contribution to the starting pot (BTN open / BB call, 2.5bb). */
const PREFLOP_CONTRIBUTION = 25;

interface LoadedHand {
  solve: SolveFile;
  inst: PlayInstance;
  index: number;
  clientHandId: string;
}

interface DecisionRecord {
  clientDecisionId: string;
  phase: "preflop" | "postflop";
  street: string;
  label: string;
  verdict: Verdict;
  /** Null for reference-graded preflop: its EV is unknown, never zero. */
  lossDollars: number | null;
}

interface SessionStats {
  hands: number;
  decisions: number;
  right: number;
  evLost: number;
  blunders: number;
}

const EMPTY_STATS: SessionStats = { hands: 0, decisions: 0, right: 0, evLost: 0, blunders: 0 };

type PersistenceMode = "connecting" | "remote" | "local" | "unavailable";

/** The scripted feed line for a bot action code. */
function botLine(code: string, bot: string): string {
  const info = parseAction(code);
  switch (info.kind) {
    case "check": return `${bot} checks`;
    case "fold": return `${bot} folds`;
    case "call": return `${bot} calls`;
    case "bet": return `${bot} bets ${bb(info.to!)}`;
    case "raise": return `${bot} raises to ${bb(info.to!)}`;
    case "allin": return `${bot} is all-in for ${bb(info.to!)}`;
  }
}

function heroLine(code: string): string {
  const info = parseAction(code);
  switch (info.kind) {
    case "check": return "you check";
    case "fold": return "you fold";
    case "call": return "you call";
    case "bet": return `you bet ${bb(info.to!)}`;
    case "raise": return `you raise to ${bb(info.to!)}`;
    case "allin": return `you're all-in for ${bb(info.to!)}`;
  }
}

export interface PlayShellProps {
  /** Per-request seed from the server component, like DrillShell's. */
  seed: number;
}

export function PlayShell({ seed }: PlayShellProps) {
  const [manifest, setManifest] = useState<SolveManifest | null>(null);
  const [hand, setHand] = useState<LoadedHand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // M8 durable history. Authenticated play waits for the server to create the
  // normalized session/hand before accepting a decision. Signed-out/local dev
  // still works, but is explicitly labelled as local-only.
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("connecting");
  const [remoteSession, setRemoteSession] = useState<PlaySession | null>(null);
  const [remoteHand, setRemoteHand] = useState<PlayHandSummary | null>(null);
  const [persistenceBusy, setPersistenceBusy] = useState<string | null>("Connecting history");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [handAttempt, setHandAttempt] = useState(0);
  const sessionClientIdRef = useRef<string | null>(null);
  const retryDecisionRef = useRef<(() => Promise<void>) | null>(null);
  const completionAttemptedRef = useRef<string | null>(null);
  // State updates disable the buttons on the next render; this ref also closes
  // the tiny same-tick double-click window before React commits that render.
  const decisionLockRef = useRef(false);

  // Preflop step: null = not answered yet.
  const [preflopChosen, setPreflopChosen] = useState<string | null>(null);
  const [preflopDone, setPreflopDone] = useState(false);

  // Postflop: the hero action indices taken so far. A choice commits on click
  // — there is deliberately no "reviewing" state between the click and the
  // hand continuing, because that pause is what made this feel like a quiz.
  const [chosen, setChosen] = useState<number[]>([]);

  // The transient verdict, rendered concurrently with the hand rather than
  // queued ahead of it. `nonce` restarts the animation when the same verdict
  // lands twice in a row.
  const [flash, setFlash] = useState<
    { verdict: Verdict; lossSteps: number | null; nonce: number } | null
  >(null);
  const flashSeqRef = useRef(0);

  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [review, setReview] = useState<DecisionRecord[]>([]);

  const usedRef = useRef<Set<string>>(new Set());
  const rngRef = useRef(mulberry32(seed));
  const solveCache = useRef<Map<string, SolveFile>>(new Map());
  // Guards "Next hand" while an uncached solve file is in flight: a held
  // Enter key would otherwise fire handleNextHand per key-repeat, inflating
  // the hands counter and burning unseen instances on racing fetches.
  const dealingRef = useRef(false);

  const dealNext = useCallback(
    (m: SolveManifest) => {
      if (dealingRef.current) return;
      dealingRef.current = true;
      const pick = pickHand(m, usedRef.current, rngRef.current);
      usedRef.current.add(handId(pick.flop, pick.index));
      const cached = solveCache.current.get(pick.flop);
      const ready = (solve: SolveFile) => {
        dealingRef.current = false;
        setHand({
          solve,
          inst: solve.instances[pick.index],
          index: pick.index,
          clientHandId: newPlayClientId(),
        });
        setRemoteHand(null);
        setPersistenceError(null);
        retryDecisionRef.current = null;
        completionAttemptedRef.current = null;
        decisionLockRef.current = false;
        setPreflopChosen(null);
        setPreflopDone(false);
        setChosen([]);
        setFlash(null);
        setReview([]);
      };
      if (cached) {
        ready(cached);
        return;
      }
      fetchSolve(pick.flop)
        .then((solve) => {
          solveCache.current.set(pick.flop, solve);
          ready(solve);
        })
        .catch((err) => {
          dealingRef.current = false;
          setLoadError(String(err));
        });
    },
    []
  );

  // Initial load — network reads cannot happen during render, so this is the
  // same legitimate-effect exception DrillShell's seeding uses.
  useEffect(() => {
    let cancelled = false;
    fetchManifest()
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        dealNext(m);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [dealNext]);

  // Start one normalized practice session. The client UUID is retained across
  // retries, so a timeout after a successful insert cannot create a duplicate.
  useEffect(() => {
    if (remoteSession) return;
    let cancelled = false;
    if (!sessionClientIdRef.current) sessionClientIdRef.current = newPlayClientId();
    void createPlaySession(sessionClientIdRef.current)
      .then((session) => {
        if (cancelled) return;
        setRemoteSession(session);
        setPersistenceMode("remote");
        setPersistenceBusy(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const error = reason as PlayApiError;
        const message = reason instanceof Error ? reason.message : String(reason);
        setPersistenceBusy(null);
        if (error.status === 401 || message === "Supabase is not configured.") {
          setPersistenceMode("local");
          setPersistenceError(message);
        } else {
          setPersistenceMode("unavailable");
          setPersistenceError(message);
        }
      });
    return () => { cancelled = true; };
  }, [remoteSession, sessionAttempt]);

  // Link every dealt scripted instance to its durable hand row before the
  // player can act. The same client UUID is reused when the user retries.
  useEffect(() => {
    if (persistenceMode !== "remote" || !remoteSession || !hand) return;
    if (remoteHand?.client_hand_id === hand.clientHandId) return;
    let cancelled = false;
    void createPlayHand(
      remoteSession.id,
      hand.clientHandId,
      hand.solve.flop,
      hand.index
    )
      .then((savedHand) => {
        if (cancelled) return;
        setRemoteHand(savedHand);
        setPersistenceBusy(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPersistenceBusy(null);
        setPersistenceError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [persistenceMode, remoteSession, hand, remoteHand, handAttempt]);

  const inst = hand?.inst ?? null;
  const startPot = hand?.solve.pot ?? 55;
  const stack = hand?.solve.stack ?? 975;

  const preflop: PreflopDecision | null = useMemo(
    () => (inst ? preflopDecision(inst.hero, inst.hand) : null),
    [inst]
  );

  const events: HandEvent[] = useMemo(
    () => (inst && preflopDone ? timeline(inst, chosen) : []),
    [inst, preflopDone, chosen]
  );

  const heroCards: Card[] = useMemo(() => (inst ? holeCards(inst.hand) : []), [inst]);
  const botCards: Card[] = useMemo(() => (inst ? holeCards(inst.bot) : []), [inst]);
  const board: Card[] = useMemo(
    () => (inst && preflopDone && hand ? boardFrom(hand.solve.flop, events) : []),
    [inst, preflopDone, hand, events]
  );

  const last = events[events.length - 1];
  const atDecision = awaitingHero(events) && last?.type === "decision" ? last : null;
  const over = handOver(events) && last?.type === "end" ? last : null;

  // — playback —
  // `events` is what has HAPPENED; `revealed` is what the player has SEEN.
  // Keeping those apart is what lets the table animate at all.
  const beats = useMemo(
    () => (inst && preflopDone ? beatsFor(events, inst.hero) : []),
    [inst, preflopDone, events]
  );
  const director = useHandDirector(beats);
  const revealed = useMemo(
    () => beats.slice(0, director.applied),
    [beats, director.applied]
  );

  const potShown = useMemo(
    () =>
      revealed.reduce((sum, b) => (b.kind === "chips" ? sum + b.chips : sum), startPot),
    [revealed, startPot]
  );
  const dealtShown = revealed.filter((b) => b.kind === "board").length;
  const showdownShown = revealed.some((b) => b.kind === "showdown");

  // The flop arrives whole with the street; only turn and river are dealt as
  // events, so only those are gated on playback.
  const boardShown = useMemo(
    () => [...board.slice(0, 3), ...board.slice(3, 3 + dealtShown)],
    [board, dealtShown]
  );

  // Chips the hero has put in this hand, so the seat shows what is BEHIND
  // rather than the starting stack — a stack that never moves reads as fake.
  const wageredShown = useMemo(() => {
    const totals = { hero: 0, villain: 0 };
    for (const b of revealed) if (b.kind === "chips") totals[b.seat] += b.chips;
    return totals;
  }, [revealed]);

  // Only while the queue is still running: once it drains at a decision, a
  // chip badge left hanging over the felt reads as part of the layout.
  const lastRevealed = revealed[revealed.length - 1];
  const chipFlight =
    director.playing && lastRevealed?.kind === "chips"
      ? { seat: lastRevealed.seat, chips: lastRevealed.chips }
      : null;

  const heroSeat = inst?.hero === 1 ? "BTN (you)" : "BB (you)";
  const botName = inst?.hero === 1 ? "BB" : "BTN";

  // Showdown outcome, computed with the app's own evaluator.
  const outcome = useMemo(() => {
    if (!over || !inst) return null;
    const tb = over.end.tb;
    const pot = potAfter(startPot, tb);
    const heroIn = PREFLOP_CONTRIBUTION + tb[inst.hero];
    if (over.end.k === "f") return { text: `You fold — ${botName} takes ${bb(pot)}`, net: -heroIn, showdown: false };
    if (over.end.k === "bf") return { text: `${botName} folds — you take the pot`, net: pot - heroIn, showdown: false };
    const cmp = whoIsAhead(heroCards, botCards, board);
    if (cmp > 0) return { text: `Showdown — you win ${bb(pot)}`, net: pot - heroIn, showdown: true };
    if (cmp < 0) return { text: `Showdown — ${botName} wins ${bb(pot)}`, net: -heroIn, showdown: true };
    return { text: "Showdown — chopped pot", net: pot / 2 - heroIn, showdown: true };
  }, [over, inst, startPot, heroCards, botCards, board, botName]);

  /** The action feed, street by street, from the answered events. */
  const feed = useMemo(() => {
    if (!inst || !preflopDone) return [];
    const rows: string[] = [];
    const open = inst.hero === 1 ? "you open to 2.5bb" : "BTN opens to 2.5bb";
    const call = inst.hero === 1 ? "BB calls" : "you call";
    rows.push(`Preflop — ${open}, ${call}`);
    let street = 0;
    let line: string[] = [];
    const flush = () => {
      if (line.length) rows.push(`${STREET_NAME[street]} — ${line.join(", ")}`);
      line = [];
    };
    for (const e of events) {
      if (e.type === "card") {
        flush();
        street += 1;
      } else if (e.type === "bot") {
        line.push(botLine(e.code, botName));
      } else if (e.type === "decision" && e.chosen !== undefined) {
        line.push(heroLine(e.node.a[e.chosen]));
      }
    }
    flush();
    return rows;
  }, [inst, preflopDone, events, botName]);

  const currentRemoteReady = Boolean(
    hand && remoteHand && remoteHand.client_hand_id === hand.clientHandId
  );
  const canAct =
    persistenceMode === "local" ||
    (persistenceMode === "remote" && currentRemoteReady && !persistenceBusy && !persistenceError);

  const recordDecision = useCallback(
    (rec: DecisionRecord) => {
      const right = isRightVerdict(rec.verdict);
      setReview((r) => [...r, rec]);
      setStats((s) => ({
        ...s,
        decisions: s.decisions + 1,
        right: s.right + (right ? 1 : 0),
        evLost: s.evLost + (rec.lossDollars ?? 0),
        blunders: s.blunders + (rec.verdict === "blunder" ? 1 : 0),
      }));
    },
    []
  );

  const reconcileDecision = useCallback(
    (local: DecisionRecord, saved: PlayDecisionReview) => {
      const savedVerdict: Verdict = saved.verdict === "ungraded" ? local.verdict : saved.verdict;
      const savedLoss = saved.ev_loss_bb === null ? null : saved.ev_loss_bb * 10;
      setReview((records) => records.map((record) =>
        record.clientDecisionId === local.clientDecisionId
          ? { ...record, verdict: savedVerdict, lossDollars: savedLoss }
          : record
      ));
      const localRight = isRightVerdict(local.verdict);
      const savedRight = isRightVerdict(savedVerdict);
      setStats((statsNow) => ({
        ...statsNow,
        right: statsNow.right + Number(savedRight) - Number(localRight),
        evLost: statsNow.evLost + (savedLoss ?? 0) - (local.lossDollars ?? 0),
        blunders:
          statsNow.blunders + Number(savedVerdict === "blunder") - Number(local.verdict === "blunder"),
      }));
    },
    []
  );

  const persistDecision = useCallback(
    (local: DecisionRecord, nodePath: string, chosenActionCode: string) => {
      if (persistenceMode === "local") return;
      if (persistenceMode !== "remote" || !remoteHand) return;
      const savedHandId = remoteHand.id;
      const body = buildPlayDecisionBody(local.clientDecisionId, nodePath, chosenActionCode);
      const submit = async () => {
        setPersistenceBusy("Saving decision");
        setPersistenceError(null);
        try {
          const saved = await createPlayDecision(savedHandId, body);
          reconcileDecision(local, saved);
          retryDecisionRef.current = null;
          setPersistenceBusy(null);
        } catch (reason) {
          setPersistenceBusy(null);
          setPersistenceError(reason instanceof Error ? reason.message : String(reason));
          retryDecisionRef.current = submit;
        }
      };
      void submit();
    },
    [persistenceMode, remoteHand, reconcileDecision]
  );

  const handlePreflop = useCallback(
    (key: string) => {
      if (
        !inst || !preflop || !hand || preflopChosen !== null ||
        !canAct || decisionLockRef.current
      ) return;
      decisionLockRef.current = true;
      setPreflopChosen(key);
      const clientDecisionId = newPlayClientId();
      const verdict: Verdict =
        key === preflop.answer
          ? "correct"
          : preflop.acceptable.includes(key)
            ? "acceptable"
            : "blunder";
      const local: DecisionRecord = {
        clientDecisionId,
        phase: "preflop",
        street: "Preflop",
        label: preflop.options.find((o) => o.key === key)?.label ?? key,
        verdict,
        lossDollars: null,
      };
      recordDecision(local);
      persistDecision(local, "preflop", key);
    },
    [inst, preflop, hand, preflopChosen, canAct, recordDecision, persistDecision]
  );

  const handleAction = useCallback(
    (i: number) => {
      if (!inst || !hand || !atDecision || !canAct || decisionLockRef.current) return;
      decisionLockRef.current = true;
      const node = atDecision.node;
      const clientDecisionId = newPlayClientId();
      const verdict = verdictAt(node, i);
      const local: DecisionRecord = {
        clientDecisionId,
        phase: "postflop",
        street: STREET_NAME[node.st],
        label: actionLabelBb(node.a[i], {
          potChips: potAfter(startPot, node.tb),
          toCallChips: toCallAt(node, inst.hero),
        }),
        verdict,
        lossDollars: lossDollars(node.l[i]),
      };
      recordDecision(local);
      persistDecision(local, atDecision.key || "root", node.a[i]);
      // Non-blocking: the hand advances now and the verdict rides alongside it.
      // Nothing here waits for the player to acknowledge anything.
      flashSeqRef.current += 1;
      setFlash({ verdict, lossSteps: node.l[i], nonce: flashSeqRef.current });
      setChosen((c) => [...c, i]);
    },
    [inst, hand, atDecision, canAct, startPot, recordDecision, persistDecision]
  );

  // The action commits synchronously, but React has not yet re-rendered with
  // the next decision — `decisionLockRef` closes that window against a
  // double-click or a held key. Writing a ref here is not the banned
  // setState-in-effect: nothing re-renders as a result.
  useEffect(() => {
    decisionLockRef.current = false;
  }, [chosen, preflopDone]);

  /**
   * Preflop only. It is graded against reference ranges rather than the solve,
   * so it stays a separate, explicitly-labelled step with its own hand-off
   * into the solved line — see the "reference range" note in its panel.
   * Postflop has no continue: actions commit on click.
   */
  const handleContinue = useCallback(() => {
    if (persistenceMode === "remote" && (persistenceBusy || persistenceError)) return;
    if (!preflopDone && preflopChosen !== null) {
      decisionLockRef.current = false;
      setPreflopDone(true);
    }
  }, [persistenceMode, persistenceBusy, persistenceError, preflopDone, preflopChosen]);

  const completeRemoteHand = useCallback(async () => {
    if (!remoteHand) return;
    const savedHandId = remoteHand.id;
    setPersistenceBusy("Finalizing hand");
    setPersistenceError(null);
    try {
      const completed = await updatePlayHand(savedHandId, "completed");
      setRemoteHand(completed);
      retryDecisionRef.current = null;
      setPersistenceBusy(null);
    } catch (reason) {
      setPersistenceBusy(null);
      setPersistenceError(reason instanceof Error ? reason.message : String(reason));
      retryDecisionRef.current = async () => {
        completionAttemptedRef.current = null;
        setPersistenceError(null);
      };
    }
  }, [remoteHand]);

  // Completion is a separate server validation: a collection of decisions is
  // not called complete until its stored path reaches this instance's terminal.
  useEffect(() => {
    if (
      !over || persistenceMode !== "remote" || !remoteHand ||
      remoteHand.status !== "incomplete" || persistenceBusy || persistenceError ||
      completionAttemptedRef.current === remoteHand.id
    ) return;
    completionAttemptedRef.current = remoteHand.id;
    void completeRemoteHand();
  }, [over, persistenceMode, remoteHand, persistenceBusy, persistenceError, completeRemoteHand]);

  const canDealNext =
    persistenceMode === "local" ||
    (persistenceMode === "remote" && remoteHand?.status === "completed");

  const handleNextHand = useCallback(() => {
    if (!manifest || dealingRef.current || !canDealNext) return;
    setStats((s) => ({ ...s, hands: s.hands + 1 }));
    dealNext(manifest);
  }, [manifest, canDealNext, dealNext]);

  const retryPersistence = useCallback(() => {
    if (retryDecisionRef.current) {
      void retryDecisionRef.current();
    } else if (persistenceMode === "unavailable") {
      setPersistenceMode("connecting");
      setPersistenceBusy("Connecting history");
      setPersistenceError(null);
      setSessionAttempt((attempt) => attempt + 1);
    } else if (persistenceMode === "remote") {
      setPersistenceBusy("Saving dealt hand");
      setPersistenceError(null);
      setHandAttempt((attempt) => attempt + 1);
    }
  }, [persistenceMode]);

  // Keyboard: 1..n pick an action, Enter/N continue or next hand.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter" || e.key.toUpperCase() === "N") {
        e.preventDefault();
        if (over) handleNextHand();
        else handleContinue();
        return;
      }

      // Any key skips playback. Checked before the action keys so a player
      // hammering "2" to bet does not have the skip swallow their action.
      if (director.playing) {
        e.preventDefault();
        director.skip();
        return;
      }

      // F folds and C checks-or-calls. There is deliberately no R: a node can
      // offer several raise sizes, so one key cannot name a raise
      // unambiguously, and "the first raise" would submit a size nobody chose.
      if (atDecision) {
        const key = e.key.toUpperCase();
        if (key === "F" || key === "C") {
          const wanted = key === "F" ? ["fold"] : ["check", "call"];
          const idx = atDecision.node.a.findIndex((code) =>
            wanted.includes(parseAction(code).kind)
          );
          if (idx >= 0) {
            e.preventDefault();
            handleAction(idx);
            return;
          }
        }
      }

      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0) return;
      if (!preflopDone && preflop && preflopChosen === null) {
        if (idx < preflop.options.length) {
          e.preventDefault();
          handlePreflop(preflop.options[idx].key);
        }
      } else if (atDecision && idx < atDecision.node.a.length) {
        e.preventDefault();
        handleAction(idx);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    over, preflopDone, preflop, preflopChosen, atDecision, director,
    handleNextHand, handleContinue, handlePreflop, handleAction,
  ]);

  if (loadError) {
    return (
      <main className="page">
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>
          <p>Could not load the play-mode data: {loadError}</p>
          <p style={{ fontSize: 13 }}>
            The solve files live under <code>/solves/{SPOT}/</code> — run
            <code> solver/run-all.sh</code> and <code>solver/publish.sh</code> to build them.
          </p>
        </div>
      </main>
    );
  }

  if (!inst || !hand || !preflop) {
    return (
      <main className="page">
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>Dealing…</div>
      </main>
    );
  }

  const decisionsThisHand = review.length;
  const accuracy =
    stats.decisions > 0 ? Math.round((stats.right / stats.decisions) * 100) : null;

  // Money strip for the current state.
  const stripNode = atDecision?.node ?? null;
  const strip = (() => {
    if (over) {
      return [
        { label: "Final pot", value: bb(potAfter(startPot, over.end.tb)) },
        { label: "Your result", value: signedBb(outcome?.net ?? 0) },
      ];
    }
    if (!preflopDone) {
      return [
        { label: "Blinds", value: "0.5 / 1bb" },
        { label: "Effective stacks", value: bb(1000) },
      ];
    }
    if (stripNode) {
      const pot = potAfter(startPot, stripNode.tb);
      const toCall = toCallAt(stripNode, inst.hero);
      return [
        { label: "Pot", value: bb(pot) },
        ...(toCall > 0 ? [{ label: "To call", value: bb(toCall) }] : []),
        { label: "Behind", value: bb(stack - stripNode.tb[inst.hero]) },
      ];
    }
    return [{ label: "Pot", value: bb(startPot) }];
  })();

  return (
    <main className="page">
      <div className="switcher">
        <div className="left">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="mono-label accent" style={{ letterSpacing: ".12em" }}>
              PLAY — SOLVER PRACTICE
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 24,
                lineHeight: 1.05, letterSpacing: ".02em", textTransform: "uppercase",
              }}
            >
              BTN vs BB — single-raised pot
            </span>
          </div>
        </div>
        <div className="right">
          <span className="tag tag-neutral tag-mono">100bb · simplified tree</span>
          <span className="tag tag-outline tag-mono">{heroSeat}</span>
        </div>
      </div>

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
                {over ? "Hand complete" : !preflopDone ? "Preflop" : STREET_NAME[stripNode?.st ?? 0]}
              </span>
              <span className="tag tag-neutral tag-mono">Hand {stats.hands + 1}</span>
              <span className="mono-label" style={{ marginLeft: "auto", letterSpacing: ".08em" }}>
                {SPOT}
              </span>
            </div>

            {/* Click anywhere on the table to skip the rest of the playback. */}
            <div className="pt-stage" onClick={director.skip}>
              <PokerTable
                heroPosition={inst.hero === 1 ? "BTN" : "BB"}
                villainPosition={inst.hero === 1 ? "BB" : "BTN"}
                heroCards={heroCards}
                villainCards={botCards}
                showdown={showdownShown}
                board={boardShown}
                potChips={potShown}
                heroStackChips={stack - wageredShown.hero}
                villainStackChips={stack - wageredShown.villain}
                activeSeat={director.playing ? "villain" : atDecision ? "hero" : null}
                chipFlight={chipFlight}
                spotLabel={SPOT}
              />
              <VerdictFlash
                verdict={flash?.verdict ?? null}
                lossSteps={flash?.lossSteps ?? null}
                nonce={flash?.nonce ?? 0}
              />
            </div>
            {director.playing && (
              <div className="pt-skip mono-label">press any key to skip</div>
            )}

            <MoneyStrip items={strip} />

            {feed.length > 0 && (
              <div style={{ margin: "0 0 var(--space-4)", display: "flex", flexDirection: "column", gap: 3 }}>
                {feed.map((row) => (
                  <div key={row} className="mono-label" style={{ letterSpacing: ".04em", fontSize: 11.5 }}>
                    {row}
                  </div>
                ))}
              </div>
            )}

            {/* — preflop decision — */}
            {!preflopDone && (
              <>
                <h2 style={{ fontSize: 26, lineHeight: 1.1, margin: "0 0 var(--space-2)" }}>
                  {inst.hero === 1
                    ? `Folded to you on the button with ${preflop.notation}.`
                    : `BTN opens to 2.5bb. You're in the big blind with ${preflop.notation}.`}
                </h2>
                <div className={`opts ${preflop.options.length === 2 ? "two" : "grid3"}`}>
                  {preflop.options.map((o, i) => {
                    let state: OptionButtonState = canAct ? "idle" : "disabled";
                    if (preflopChosen !== null) {
                      if (o.key === preflop.answer || preflop.acceptable.includes(o.key)) state = "correct";
                      else if (o.key === preflopChosen) state = "wrong";
                      else state = "disabled";
                    }
                    return (
                      <OptionButton key={o.key} keyHint={String(i + 1)} state={state} onClick={() => handlePreflop(o.key)}>
                        {o.label}
                      </OptionButton>
                    );
                  })}
                </div>
                {preflopChosen !== null && (
                  <div className={`fb${isRightVerdict(review[0]?.verdict ?? "blunder") ? "" : " no"}`}>
                    <div className="bar">
                      <span className="word">{VERDICT_WORD[review[0]?.verdict ?? "blunder"]}</span>
                      <span className="xp">
                        Reference range: {preflop.scenario.name}
                        {preflopChosen !== preflop.continues &&
                          ` — the hand continues down the solved line (${inst.hero === 1 ? "you open, BB calls" : "you call"})`}
                      </span>
                    </div>
                    <div className="body">
                      <div className="actions">
                        <button
                          className="btn btn-primary blueprint btn-caps"
                          disabled={persistenceMode === "remote" && Boolean(persistenceBusy || persistenceError)}
                          onClick={handleContinue}
                        >
                          {persistenceBusy === "Saving decision" ? "Saving…" : "See the flop"}
                          <span className="keyhint">N</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* — postflop decision — */}
            {preflopDone && atDecision && (
              <>
                <h2 style={{ fontSize: 26, lineHeight: 1.1, margin: "0 0 var(--space-2)" }}>
                  {director.playing
                    ? "…"
                    : toCallAt(atDecision.node, inst.hero) > 0
                      ? `${botName} bets — your move.`
                      : "Your move."}
                </h2>
                <ActionBar
                  codes={atDecision.node.a}
                  potChips={potAfter(startPot, atDecision.node.tb)}
                  toCallChips={toCallAt(atDecision.node, inst.hero)}
                  disabled={!canAct || director.playing}
                  onAct={handleAction}
                />
              </>
            )}

            {/* — hand over — */}
            {over && outcome && (
              <div className={`fb${(outcome.net ?? 0) >= 0 ? "" : " no"}`}>
                <div className="bar">
                  <span className="word">{outcome.text}</span>
                  <span className="xp">{signedBb(outcome.net)}</span>
                </div>
                <div className="body">
                  <WorkTable>
                    {review.map((r) => (
                      <WorkRow
                        key={r.clientDecisionId}
                        label={`${r.street} — ${r.label}`}
                        value={`${VERDICT_WORD[r.verdict]}${
                          r.lossDollars === null
                            ? " · EV unknown"
                            : r.lossDollars > 0 ? ` · −${bb(r.lossDollars)}` : ""
                        }`}
                      />
                    ))}
                  </WorkTable>
                  <div className="actions">
                    <button
                      className="btn btn-primary blueprint btn-caps"
                      disabled={!canDealNext}
                      onClick={handleNextHand}
                    >
                      {persistenceBusy === "Finalizing hand" ? "Finalizing…" : "Next hand"}
                      <span className="keyhint">N</span>
                    </button>
                    {remoteHand?.status === "completed" && (
                      <Link
                        className="btn btn-secondary btn-caps"
                        href={`/play/history/${encodeURIComponent(remoteHand.id)}`}
                      >
                        Open saved review
                      </Link>
                    )}
                    <span className="hint">or Enter</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="drill-rail">
          <div className="session-box">
            <div className="head">
              <span>This session</span>
              <span>page stats</span>
            </div>
            <div className="cells">
              <div className="cell" style={{ borderRight: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
                <div className="k">Hands</div>
                <div className="v">{stats.hands + (decisionsThisHand > 0 ? 1 : 0)}</div>
              </div>
              <div className="cell" style={{ borderBottom: "1px solid var(--color-divider)" }}>
                <div className="k">Decisions</div>
                <div className="v">{stats.decisions}</div>
              </div>
              <div className="cell" style={{ borderRight: "1px solid var(--color-divider)" }}>
                <div className="k">Accuracy</div>
                <div className="v">{accuracy !== null ? `${accuracy}%` : "—"}</div>
              </div>
              <div className="cell">
                <div className="k">EV lost</div>
                <div className="v">{stats.evLost > 0 ? `−${bb(stats.evLost)}` : "0bb"}</div>
              </div>
            </div>
            <div className="foot">
              <span>Blunders</span>
              <span>{stats.blunders}</span>
            </div>
          </div>

          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
              <div className="mono-label" style={{ letterSpacing: ".12em" }}>Hand history</div>
              <span
                className={`tag ${persistenceMode === "remote" ? "tag-neutral" : "tag-outline"} tag-mono`}
                style={{ marginLeft: "auto" }}
              >
                {remoteHand?.status === "completed"
                  ? "saved"
                  : persistenceMode === "remote" ? (persistenceBusy ? "saving" : "connected")
                    : persistenceMode === "local" ? "local only" : "unavailable"}
              </span>
            </div>
            <p
              style={{
                fontSize: 12.5, margin: "0 0 var(--space-3)",
                color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
              }}
            >
              {persistenceMode === "remote"
                ? (persistenceBusy ?? "Every choice is graded and stored by the authenticated API.")
                : persistenceMode === "local"
                  ? "This hand works locally, but it will not be available after a reload."
                  : "Play is paused until durable history reconnects."}
            </p>
            {persistenceError && persistenceMode !== "local" && (
              <div className="note critl" style={{ margin: "0 0 var(--space-3)", fontSize: 12.5 }}>
                {persistenceError}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <Link className="btn btn-secondary btn-caps" href="/play/history">Recent hands</Link>
              {persistenceError && persistenceMode !== "local" && (
                <button className="btn btn-secondary btn-caps" onClick={retryPersistence}>Retry save</button>
              )}
            </div>
          </div>

          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-2)" }}>
              This spot
            </div>
            <p style={{ fontSize: 12.5, margin: 0, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>
              BTN opens 2.5bb, BB calls — solved to &lt;0.3% pot exploitability on a
              simplified tree (one bet size per street, one raise size). Preflop is
              graded against the reference ranges; postflop against the solve.
              EV losses are shown in dollars at $10 blinds.
            </p>
          </div>

          <div className="blueprint" style={{ padding: "var(--space-4)" }}>
            <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-3)" }}>
              Keyboard
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">1</span>
                <span className="keycap">4</span>
                pick an action
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="keycap">N</span>
                <span className="keycap">Enter</span>
                continue / next hand
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
