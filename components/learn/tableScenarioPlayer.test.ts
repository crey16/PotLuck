import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TableScenario } from "../../lib/learn/types";
import { TableScenarioPlayer } from "./TableScenarioPlayer";

const SCENARIO: TableScenario = {
  id: 12,
  module_id: 3,
  difficulty: 2,
  skill_tag: "pot_odds",
  street: "flop",
  prompt_title: "Flush draw",
  situation: {
    blinds: { sb: 0.5, bb: 1 },
    effective_stack_bb: 100,
    hero: { seat: 6, position: "BTN", cards: ["9h", "8h"] },
    villains: [{ seat: 2, position: "BB", label: "Villain", style: "regular" }],
    pre_action: [{ seat: 2, action: "bet", amount_bb: 1.5 }],
    pot_bb: 5.5,
    board: ["Ah", "5h", "2c"],
  },
  choices: [
    { id: "a", label: "Fold", action: "fold" },
    { id: "b", label: "Call 1.5bb", action: "call", amount_bb: 1.5 },
  ],
};

test("table player renders the decision-time pot, cards, action, and choices", () => {
  const html = renderToStaticMarkup(
    createElement(TableScenarioPlayer, { initialScenario: SCENARIO, filters: {} })
  );
  assert.match(html, /Pot now/);
  assert.match(html, />7bb</);
  assert.match(html, /A♥/);
  assert.match(html, /BB · bet 1\.5bb/);
  assert.match(html, /Call 1\.5bb/);
});
