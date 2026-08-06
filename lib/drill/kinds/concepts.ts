/**
 * "Common OMC math mistakes" — a single-column, multiple-choice concept quiz.
 *
 * **M5 completion (2026-08-06).** This drill used to draw from a 15-item
 * static bank ported verbatim from `reference/poker-math-trainer.html`. That
 * bank was the last hole in M5's anti-repeat guarantee: the window can
 * re-roll a colliding question only if there is something else to roll into,
 * and after fifteen questions there was not. The bank is now twelve
 * **templates** in `conceptTemplates.ts`, each dealing its own cards, pot,
 * bet, stack and out count, so the space of questions is effectively
 * unbounded and every number in the prose is derived from
 * `lib/poker/math.ts` or the evaluator.
 *
 * What did not change: the drill is still prose-only — no board, no cards to
 * read, no arithmetic to perform on screen — and options are still shuffled
 * per question with the injected Rng, with the correct option's *text* used
 * as the canonical `answer` so the mapping survives the shuffle without index
 * bookkeeping.
 *
 * The old items are not lost. Every one of them is a template's degenerate
 * case, and the two whose teaching point only worked at one set of numbers
 * (the "$120 pot, $40 bet, 9 outs" fold and the "Rule of 4 all-in" call) are
 * now the templates whose answer *moves* — `call-or-fold-price` and
 * `rule-choice`. A concept drill whose answer never changes teaches players
 * to recognise the option, not the concept.
 */
import { shuffled } from "../opts";
import { CONCEPT_TEMPLATES } from "./conceptTemplates";
import type { DrillContext, ExplainNote, Generator } from "../contract";

export type { ConceptInstance, ConceptTemplate } from "./conceptTemplates";
export { CONCEPT_TEMPLATES } from "./conceptTemplates";

export const generateConcepts: Generator = (ctx: DrillContext) => {
  const template = CONCEPT_TEMPLATES[Math.floor(ctx.rng() * CONCEPT_TEMPLATES.length)];
  const item = template.build(ctx);

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
    // Some templates carry a second option that reaches the right conclusion
    // by different wording. Grading only the canonical one tells a player who
    // reasoned correctly that they were wrong (finding L-7), so the grading
    // widens while the canonical answer stays single.
    ...(item.alsoAcceptable?.length
      ? { acceptable: item.alsoAcceptable.map((i) => item.options[i]) }
      : {}),
    layout: "one",
    explain: () => ({ rows: [], notes }),
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      templateId: item.templateId,
      params: item.params,
    },
    // A repeat is the same template dealt to the same parameters, whatever
    // the option shuffle — see each template's `signature`.
    signature: `c|${item.signature}`,
  };
};
