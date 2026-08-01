"use client";

/**
 * The M6 play mode: full hands against the solver, street by street, graded
 * per decision by EV loss — GTO Wizard's practice drill, on PotLuck's data.
 *
 * All game logic lives in lib/play (pure, tested); this component is the
 * session shell: load a scripted instance, walk its timeline, collect the
 * hero's choices, show verdicts, record attempts, keep session stats.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Felt, Seat, Divider } from "@/components/ui/Felt";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { MoneyStrip } from "@/components/ui/MoneyStrip";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";
import { money } from "@/lib/drill/opts";
import { mulberry32 } from "@/lib/drill/rng";
import { recordAttempt } from "@/lib/drill/recordAttempt";
import { whoIsAhead, type Card } from "@/lib/poker/engine";
import { fetchManifest, fetchSolve, handId, pickHand, SPOT } from "@/lib/play/load";
import { actionDisplay, moneyExact, parseAction, signedMoneyExact } from "@/lib/play/actions";
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
}

interface DecisionRecord {
  phase: "preflop" | "postflop";
  street: string;
  label: string;
  verdict: Verdict;
  lossDollars: number;
}

interface SessionStats {
  hands: number;
  decisions: number;
  right: number;
  evLost: number;
  blunders: number;
}

const EMPTY_STATS: SessionStats = { hands: 0, decisions: 0, right: 0, evLost: 0, blunders: 0 };

/** The scripted feed line for a bot action code. */
function botLine(code: string, bot: string): string {
  const info = parseAction(code);
  switch (info.kind) {
    case "check": return `${bot} checks`;
    case "fold": return `${bot} folds`;
    case "call": return `${bot} calls`;
    case "bet": return `${bot} bets ${money(info.to!)}`;
    case "raise": return `${bot} raises to ${money(info.to!)}`;
    case "allin": return `${bot} is all-in for ${money(info.to!)}`;
  }
}

function heroLine(code: string): string {
  const info = parseAction(code);
  switch (info.kind) {
    case "check": return "you check";
    case "fold": return "you fold";
    case "call": return "you call";
    case "bet": return `you bet ${money(info.to!)}`;
    case "raise": return `you raise to ${money(info.to!)}`;
    case "allin": return `you're all-in for ${money(info.to!)}`;
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

  // Preflop step: null = not answered yet.
  const [preflopChosen, setPreflopChosen] = useState<string | null>(null);
  const [preflopDone, setPreflopDone] = useState(false);

  // Postflop: hero action indices taken, plus the answer being reviewed
  // before it is committed (feedback shows between click and Continue).
  const [chosen, setChosen] = useState<number[]>([]);
  const [pendingAction, setPendingAction] = useState<number | null>(null);

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
        setHand({ solve, inst: solve.instances[pick.index], index: pick.index });
        setPreflopChosen(null);
        setPreflopDone(false);
        setChosen([]);
        setPendingAction(null);
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

  const heroSeat = inst?.hero === 1 ? "BTN (you)" : "BB (you)";
  const botSeat = inst?.hero === 1 ? "BB" : "BTN";
  const botName = inst?.hero === 1 ? "BB" : "BTN";

  // Showdown outcome, computed with the app's own evaluator.
  const outcome = useMemo(() => {
    if (!over || !inst) return null;
    const tb = over.end.tb;
    const pot = potAfter(startPot, tb);
    const heroIn = PREFLOP_CONTRIBUTION + tb[inst.hero];
    if (over.end.k === "f") return { text: `You fold — ${botName} takes ${money(pot)}`, net: -heroIn, showdown: false };
    if (over.end.k === "bf") return { text: `${botName} folds — you take the pot`, net: pot - heroIn, showdown: false };
    const cmp = whoIsAhead(heroCards, botCards, board);
    if (cmp > 0) return { text: `Showdown — you win ${money(pot)}`, net: pot - heroIn, showdown: true };
    if (cmp < 0) return { text: `Showdown — ${botName} wins ${money(pot)}`, net: -heroIn, showdown: true };
    return { text: "Showdown — chopped pot", net: pot / 2 - heroIn, showdown: true };
  }, [over, inst, startPot, heroCards, botCards, board, botName]);

  /** The action feed, street by street, from the answered events. */
  const feed = useMemo(() => {
    if (!inst || !preflopDone) return [];
    const rows: string[] = [];
    const open = inst.hero === 1 ? "you open to $25" : "BTN opens to $25";
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

  const recordDecision = useCallback(
    (rec: DecisionRecord, payload: Record<string, unknown>, answer: string) => {
      const right = isRightVerdict(rec.verdict);
      setReview((r) => [...r, rec]);
      setStats((s) => ({
        ...s,
        decisions: s.decisions + 1,
        right: s.right + (right ? 1 : 0),
        evLost: s.evLost + rec.lossDollars,
        blunders: s.blunders + (rec.verdict === "blunder" ? 1 : 0),
      }));
      void recordAttempt({ kind: "play", payload, answer, correct: right });
    },
    []
  );

  const handlePreflop = useCallback(
    (key: string) => {
      if (!inst || !preflop || !hand || preflopChosen !== null) return;
      setPreflopChosen(key);
      const verdict: Verdict =
        key === preflop.answer
          ? "correct"
          : preflop.acceptable.includes(key)
            ? "acceptable"
            : "blunder";
      recordDecision(
        {
          phase: "preflop",
          street: "Preflop",
          label:
            preflop.options.find((o) => o.key === key)?.label ?? key,
          verdict,
          lossDollars: 0,
        },
        {
          spot: SPOT, flop: hand.solve.flop, instance: hand.index, phase: "preflop",
          hero: inst.hero, hand: inst.hand, notation: preflop.notation, chosen: key,
        },
        key
      );
    },
    [inst, preflop, hand, preflopChosen, recordDecision]
  );

  const handleAction = useCallback(
    (i: number) => {
      if (!inst || !hand || !atDecision || pendingAction !== null) return;
      setPendingAction(i);
      const node = atDecision.node;
      const verdict = verdictAt(node, i);
      recordDecision(
        {
          phase: "postflop",
          street: STREET_NAME[node.st],
          label: actionDisplay(parseAction(node.a[i]), {
            pot: potAfter(startPot, node.tb),
            toCall: toCallAt(node, inst.hero),
          }),
          verdict,
          lossDollars: lossDollars(node.l[i]),
        },
        {
          spot: SPOT, flop: hand.solve.flop, instance: hand.index, phase: "postflop",
          hero: inst.hero, hand: inst.hand, path: atDecision.key, street: node.st,
          chosen: node.a[i], freq: node.f[i], loss: node.l[i],
        },
        node.a[i]
      );
    },
    [inst, hand, atDecision, pendingAction, startPot, recordDecision]
  );

  const handleContinue = useCallback(() => {
    if (!preflopDone) {
      if (preflopChosen !== null) setPreflopDone(true);
      return;
    }
    if (pendingAction !== null) {
      setChosen((c) => [...c, pendingAction]);
      setPendingAction(null);
    }
  }, [preflopDone, preflopChosen, pendingAction]);

  const handleNextHand = useCallback(() => {
    if (!manifest || dealingRef.current) return;
    setStats((s) => ({ ...s, hands: s.hands + 1 }));
    dealNext(manifest);
  }, [manifest, dealNext]);

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
      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0) return;
      if (!preflopDone && preflop && preflopChosen === null) {
        if (idx < preflop.options.length) {
          e.preventDefault();
          handlePreflop(preflop.options[idx].key);
        }
      } else if (atDecision && pendingAction === null && idx < atDecision.node.a.length) {
        e.preventDefault();
        handleAction(idx);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    over, preflopDone, preflop, preflopChosen, atDecision, pendingAction,
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

  const pendingNode = pendingAction !== null && atDecision ? atDecision.node : null;
  const decisionsThisHand = review.length;
  const accuracy =
    stats.decisions > 0 ? Math.round((stats.right / stats.decisions) * 100) : null;

  // Money strip for the current state.
  const stripNode = atDecision?.node ?? null;
  const strip = (() => {
    if (over) {
      return [
        { label: "Final pot", value: money(potAfter(startPot, over.end.tb)) },
        { label: "Your result", value: signedMoneyExact(outcome?.net ?? 0) },
      ];
    }
    if (!preflopDone) {
      return [
        { label: "Blinds", value: "$5 / $10" },
        { label: "Effective stacks", value: money(1000) },
      ];
    }
    if (stripNode) {
      const pot = potAfter(startPot, stripNode.tb);
      const toCall = toCallAt(stripNode, inst.hero);
      return [
        { label: "Pot", value: money(pot) },
        ...(toCall > 0 ? [{ label: "To call", value: money(toCall) }] : []),
        { label: "Behind", value: money(stack - stripNode.tb[inst.hero]) },
      ];
    }
    return [{ label: "Pot", value: money(startPot) }];
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

            <Felt>
              <Seat label={heroSeat}>
                {heroCards.map((c) => <PlayingCard key={c} card={c} />)}
              </Seat>
              <Divider />
              <Seat label={board.length ? `Board — ${STREET_NAME[Math.max(0, board.length - 3)].toLowerCase()}` : "Board"}>
                {board.map((c) => <PlayingCard key={c} card={c} />)}
                {board.length === 0 && (
                  <span style={{ fontSize: 13, opacity: 0.6, alignSelf: "center" }}>
                    dealt after preflop
                  </span>
                )}
              </Seat>
              <Divider />
              <Seat label={outcome?.showdown ? `${botSeat} — shown` : botSeat} accent={outcome?.showdown === true}>
                {botCards.map((c) => (
                  <PlayingCard key={c} card={c} faceDown={!outcome?.showdown} />
                ))}
              </Seat>
            </Felt>

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
                    : `BTN opens to $25. You're in the big blind with ${preflop.notation}.`}
                </h2>
                <div className={`opts ${preflop.options.length === 2 ? "two" : "grid3"}`}>
                  {preflop.options.map((o, i) => {
                    let state: OptionButtonState = "idle";
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
                        <button className="btn btn-primary blueprint btn-caps" onClick={handleContinue}>
                          See the flop
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
                  {toCallAt(atDecision.node, inst.hero) > 0
                    ? `${botName} bets — your move.`
                    : "Your move."}
                </h2>
                <div className={`opts ${atDecision.node.a.length === 2 ? "two" : "grid3"}`}>
                  {atDecision.node.a.map((code, i) => {
                    let state: OptionButtonState = "idle";
                    if (pendingNode) {
                      const v = verdictAt(pendingNode, i);
                      if (i === pendingAction) state = isRightVerdict(v) ? "correct" : "wrong";
                      else state = "disabled";
                    }
                    return (
                      <OptionButton key={code} keyHint={String(i + 1)} state={state} onClick={() => handleAction(i)}>
                        {actionDisplay(parseAction(code), {
                          pot: potAfter(startPot, atDecision.node.tb),
                          toCall: toCallAt(atDecision.node, inst.hero),
                        })}
                        {pendingNode && ` — GTO ${Math.round((pendingNode.f[i] / 255) * 100)}%`}
                      </OptionButton>
                    );
                  })}
                </div>

                {pendingNode && pendingAction !== null && (
                  <div className={`fb${isRightVerdict(verdictAt(pendingNode, pendingAction)) ? "" : " no"}`}>
                    <div className="bar">
                      <span className="word">{VERDICT_WORD[verdictAt(pendingNode, pendingAction)]}</span>
                      <span className="xp">
                        {pendingNode.l[pendingAction] > 0
                          ? `EV loss ${moneyExact(lossDollars(pendingNode.l[pendingAction]))}`
                          : "Best play"}
                      </span>
                    </div>
                    <div className="body">
                      <WorkTable>
                        {pendingNode.a.map((code, i) => (
                          <WorkRow
                            key={code}
                            label={actionDisplay(parseAction(code), {
                              pot: potAfter(startPot, pendingNode.tb),
                              toCall: toCallAt(pendingNode, inst.hero),
                            })}
                            value={`${Math.round((pendingNode.f[i] / 255) * 100)}%${
                              pendingNode.l[i] > 0 ? ` · −${moneyExact(lossDollars(pendingNode.l[i]))}` : ""
                            }`}
                          />
                        ))}
                        <WorkRow
                          label="Your equity vs their range"
                          value={`${Math.round((pendingNode.eq / 255) * 100)}%`}
                        />
                      </WorkTable>
                      <div className="actions">
                        <button className="btn btn-primary blueprint btn-caps" onClick={handleContinue}>
                          Continue
                          <span className="keyhint">N</span>
                        </button>
                        <span className="hint">or Enter</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* — hand over — */}
            {over && outcome && (
              <div className={`fb${(outcome.net ?? 0) >= 0 ? "" : " no"}`}>
                <div className="bar">
                  <span className="word">{outcome.text}</span>
                  <span className="xp">{signedMoneyExact(outcome.net)}</span>
                </div>
                <div className="body">
                  <WorkTable>
                    {review.map((r, i) => (
                      <WorkRow
                        key={i}
                        label={`${r.street} — ${r.label}`}
                        value={`${VERDICT_WORD[r.verdict]}${r.lossDollars > 0 ? ` · −${moneyExact(r.lossDollars)}` : ""}`}
                      />
                    ))}
                  </WorkTable>
                  <div className="actions">
                    <button className="btn btn-primary blueprint btn-caps" onClick={handleNextHand}>
                      Next hand
                      <span className="keyhint">N</span>
                    </button>
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
              <span>resets on reload</span>
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
                <div className="v">{stats.evLost > 0 ? `−${moneyExact(stats.evLost)}` : "$0"}</div>
              </div>
            </div>
            <div className="foot">
              <span>Blunders</span>
              <span>{stats.blunders}</span>
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
