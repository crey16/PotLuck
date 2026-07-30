/**
 * "Common OMC math mistakes" — a port of the reference trainer's CONCEPTS
 * bank and Q.concepts (poker-math-trainer.html lines 925-978) onto the M2
 * drill contract.
 *
 * A single-column, multiple-choice concept quiz: no board, no cards, no
 * poker math to compute — the whole drill is picking the right prose out of
 * four options. Options are shuffled per question with the injected Rng;
 * the correct option's text is used as the canonical `answer` value so the
 * mapping survives the shuffle without any index bookkeeping.
 *
 * NB: the reference bank has 15 items (verified by counting "{q:" entries
 * in lines 925-971), not 16. Ported verbatim as 15. Item index 9 (the
 * "$120 pot, $40 bet, 9 outs" item) is the one whose correct answer is not
 * the first option — its `a:2` in the reference source, preserved here as
 * `correct: 2`. Options 0 and 2 for that item say nearly the same thing in
 * different words, so this is not a typo to "fix".
 */
import { pick, shuffled } from "../opts";
import type { DrillContext, ExplainNote, Generator } from "../contract";

export interface ConceptItem {
  prompt: string;
  options: string[];
  correct: number;
  explain: string;
  /**
   * Indices of options that reach the same conclusion as `correct` by other
   * wording, and so must also grade as right. The reference bank scores a
   * single index, but one of its items pairs the canonical answer with a
   * differently-worded option stating the same thing — grading only the
   * canonical one tells a correct reasoner they were wrong (finding L-7).
   */
  alsoAcceptable?: number[];
}

export const CONCEPTS: ConceptItem[] = [
  {
    prompt: "You flop a flush draw and villain shoves all-in. Which rule applies?",
    options: [
      "Rule of 4 — you’ll see both cards",
      "Rule of 2 — one card at a time",
      "Neither; use 3× outs",
      "Rule of 4, then halve it",
    ],
    correct: 0,
    explain:
      "All-in means both cards come with no further betting, so the ×4 estimate is the honest one. The mistake is using ×4 when there is still betting to come — then you often only get to see the turn, and should price with ×2.",
  },
  {
    prompt:
      "The pot is $100 and villain bets $50. An OMC says “I’m getting 2 to 1, easy call.” What’s wrong?",
    options: [
      "Nothing about the odds — but 2:1 means he needs 33%, not that any hand calls",
      "He’s getting 3 to 1, not 2 to 1",
      "Pot odds don’t apply on the flop",
      "He should count the rake first",
    ],
    correct: 0,
    explain:
      "$150 to win for $50 is 3:1 — he’s misquoting. Either way, odds are only half the equation: the price tells you the equity threshold (25% here), and you still have to know whether your hand clears it.",
  },
  {
    prompt:
      "You hold 8♠8♣ on A♥K♠7♦. You count “2 outs to a set plus 2 eights already gone — call’s fine.” The error is:",
    options: [
      "Counting outs that don’t exist and ignoring how small 2 outs is",
      "Eights are always live",
      "You should count 4 outs for a pair",
      "Two outs is enough at 3:1",
    ],
    correct: 0,
    explain:
      "Two outs is about 8% to the river — you need roughly 11:1 to call. Wishful out-counting is the single most common live-poker math leak.",
  },
  {
    // Villain must hold TWO hearts for the hero's flush outs to be dead. The
    // earlier version had them on A♥K♠ and called the K♥ dead "because it gives
    // villain Broadway" — villain cannot make Broadway without a jack and a ten,
    // and the K♥ actually gives the HERO a king-high straight flush. The
    // evaluator says that spot has no dead outs at all and that all four listed
    // options were real outs, so the question had no correct answer. Verified
    // against outsVsHand/deadOuts — see concepts.test.ts.
    prompt: "Which of these is NOT a real out when you hold J♥T♥ on Q♥9♥2♠ against A♥K♥?",
    options: ["The 7♥", "The 8♠", "The J♠", "The K♠"],
    correct: 0,
    explain:
      "The 7♥ completes your flush, but villain holds A♥K♥ — their flush is bigger, so yours never wins. Cards that improve you and improve them more are dead outs. Note the 8♥ is still a real out: it makes you a straight flush.",
  },
  {
    prompt: "What does ‘equity’ mean in poker?",
    options: [
      "Your percentage share of the pot given how often you’ll win it",
      "The money you’ve invested in the hand",
      "How much you can win on later streets",
      "Your chip stack relative to the blinds",
    ],
    correct: 0,
    explain:
      "Equity is your ownership share. In a $200 pot with 35% equity, $70 of that pot is already yours in the long run — every decision compares that against what it costs to keep playing.",
  },
  {
    prompt: "Why does the Rule of 4 overstate your equity with a big draw like 15 outs?",
    options: [
      "It double-counts runouts where you’d have hit on both cards",
      "It ignores villain’s outs",
      "Because 15 outs is impossible",
      "It assumes you always see the river",
    ],
    correct: 0,
    explain:
      "Multiplying by 4 treats the turn and river as independent additive chances. The overlap — hitting on both — gets counted twice. 15 outs is really about 54%, not 60%. Fix: subtract one point per out above 8.",
  },
  {
    prompt: "You call a river bet and lose. Was the call a mistake?",
    options: [
      "Can’t tell from the result — only from whether your equity beat the price",
      "Yes, you lost money",
      "No, because you had a good read",
      "Yes, you should never call rivers",
    ],
    correct: 0,
    explain:
      "Results tell you nothing about a single decision. A +EV call loses plenty of the time; that’s what ‘70% to lose’ means. Judge the decision by the price and your equity, not the card.",
  },
  {
    prompt:
      "You have the second-nut flush draw against an opponent who has never bluffed. What should you adjust?",
    options: [
      "Discount implied odds for reverse implied odds",
      "Increase implied odds — they always pay",
      "Nothing — a flush is a flush",
      "Fold all flush draws to nits",
    ],
    correct: 0,
    explain:
      "When you hit and they keep betting, you may be drawing to the losing end of the pot. Against a player who only bets strong hands, the times you get paid are exactly the times you’re beaten.",
  },
  {
    prompt:
      "An OMC folds every turn to a big bet, saying “I can’t call without the nuts.” Which concept says this is exploitable?",
    options: [
      "Minimum defence frequency",
      "Implied odds",
      "The rule of 2 and 4",
      "Reverse implied odds",
    ],
    correct: 0,
    explain:
      "MDF says against a pot-sized bet you must continue with about half your range, or a bettor can profitably bluff with any two cards. Folding far more than that hands out free pots.",
  },
  {
    prompt: "Pot is $120 after villain bets $40. You have 9 outs on the turn. Call or fold?",
    options: [
      "Call — you need 25% and have about 20%... which is a fold",
      "Call — 9 outs is always enough",
      "Fold — you need 25% and have about 20%",
      "Raise — 9 outs plus fold equity",
    ],
    correct: 2,
    // Option 0 opens "Call —" but ends "...which is a fold", i.e. the same
    // conclusion as option 2. Read to the end it is correct reasoning.
    alsoAcceptable: [0],
    explain:
      "Nine outs with one card to come is 9×2 ≈ 18–20%. The price demands $40 ÷ $160 = 25%. Without implied odds this is a clear fold — the classic ‘but I have a flush draw!’ trap.",
  },
  {
    prompt: "Which bet size needs the fewest folds to break even as a bluff?",
    options: ["1/3 pot", "1/2 pot", "3/4 pot", "Pot"],
    correct: 0,
    explain:
      "Risk ÷ (risk + reward): 1/3 pot needs 25%, 1/2 needs 33%, 3/4 needs 43%, pot needs 50%. Small bluffs need to work least often — which is why they can be run with a much wider range.",
  },
  {
    prompt:
      "You’re on the flop with an open-ender and there is a lot of money left behind. What’s the biggest math error you can make?",
    options: [
      "Using ×4 to justify a call when you’ll likely face another bet on the turn",
      "Using ×2 instead of ×4",
      "Counting 8 outs instead of 4",
      "Adding your implied odds",
    ],
    correct: 0,
    explain:
      "×4 assumes you see both cards for free. If villain will bet the turn too, you’re really paying for one card now — price it with ×2 and factor in what the turn will cost you.",
  },
  {
    prompt: "What makes a call ‘break-even’?",
    options: [
      "Your equity exactly equals call ÷ (pot + call)",
      "You win exactly half the time",
      "The pot is twice the bet",
      "Your outs times 2 equals the bet size",
    ],
    correct: 0,
    explain:
      "That single identity ties pot odds, equity and EV together. Above the threshold you print; below it you leak.",
  },
  {
    prompt:
      "Villain bets $50 into $100 and you have $50 left behind. How much are your implied odds worth?",
    options: ["Nothing — calling puts you all-in", "$50", "$150", "Twice the pot"],
    correct: 0,
    explain:
      "Implied odds require money to still be behind after the call. Once you’re all-in there are no future streets to collect on — price it on direct pot odds only.",
  },
  {
    prompt:
      "You have 12 outs on the flop and are all-in. Rule of 4 says 48%. What is the honest number?",
    options: ["About 45%", "Exactly 48%", "About 55%", "About 38%"],
    correct: 0,
    explain:
      "The correction — subtract one point per out above 8 — gives 48 − 4 = 44%, and the exact figure is 45%. Close enough at the table, and it stops you talking yourself into a coinflip you’re losing.",
  },
];

export const generateConcepts: Generator = (ctx: DrillContext) => {
  const ids = CONCEPTS.map((_, i) => i);
  const conceptId = pick(ids, ctx.rng);
  const item = CONCEPTS[conceptId];

  const opts = shuffled(
    item.options.map((label, i) => ({ label, value: label, isCorrect: i === item.correct })),
    ctx.rng
  );

  const notes: ExplainNote[] = [{ tone: "plain", text: item.explain }];

  return {
    kind: "concepts",
    kicker: "Common OMC math mistakes",
    chip: "Concept",
    prompt: item.prompt,
    body: [],
    options: opts.map((o) => ({ label: o.label, value: o.value })),
    answer: item.options[item.correct],
    // Some bank items carry a second option that reaches the right conclusion
    // by different wording — item 9's "Call — … which is a fold" states the
    // same fold as the canonical "Fold — …" answer, so a user who reads it to
    // the end has reasoned correctly and must not be told "Not quite."
    // (finding L-7). The bank text stays verbatim; only the grading widens.
    ...(item.alsoAcceptable?.length
      ? { acceptable: item.alsoAcceptable.map((i) => item.options[i]) }
      : {}),
    layout: "one",
    explain: () => ({ rows: [], notes }),
    payload: { level: ctx.level, oppMode: ctx.oppMode, conceptId },
  };
};
