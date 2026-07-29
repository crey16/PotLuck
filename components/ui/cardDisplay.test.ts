/**
 * Run with:  npx tsx --test components/ui/cardDisplay.test.ts
 *
 * Pure unit tests for the presentation-logic helper that PlayingCard consumes.
 * No DOM library needed since this only tests plain data derivation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../../lib/poker/engine.js";
import { cardDisplayParts } from "./cardDisplay.js";

test("T renders as 10", () => {
  const parts = cardDisplayParts(parseCard("Ts"));
  assert.equal(parts.rankText, "10");
});

test("non-T ranks render as-is", () => {
  assert.equal(cardDisplayParts(parseCard("9c")).rankText, "9");
  assert.equal(cardDisplayParts(parseCard("Ah")).rankText, "A");
});

test("ace of hearts is red with the heart glyph", () => {
  const parts = cardDisplayParts(parseCard("Ah"));
  assert.equal(parts.suitGlyph, "♥");
  assert.equal(parts.colorClass, "red");
});

test("7 of diamonds is red normally but blu in four-color mode", () => {
  const card = parseCard("7d");
  assert.equal(cardDisplayParts(card).colorClass, "red");
  assert.equal(cardDisplayParts(card, true).colorClass, "blu");
});

test("clubs are default ink normally but grn in four-color mode", () => {
  const card = parseCard("9c");
  assert.equal(cardDisplayParts(card).colorClass, "");
  assert.equal(cardDisplayParts(card, true).colorClass, "grn");
});

test("spades are always default ink", () => {
  const card = parseCard("Ks");
  assert.equal(cardDisplayParts(card).colorClass, "");
  assert.equal(cardDisplayParts(card, true).colorClass, "");
});
