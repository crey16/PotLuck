// Money is integer cents everywhere in the home-game tracker (docs/19).
// These two functions are the only place dollars-as-text exists.

import test from "node:test";
import assert from "node:assert/strict";
import { formatCents, parseDollarsToCents } from "./money";

test("formatCents renders whole and fractional amounts", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(12345), "$123.45");
  assert.equal(formatCents(6000), "$60.00");
  assert.equal(formatCents(5), "$0.05");
});

test("formatCents renders negatives with a leading minus", () => {
  assert.equal(formatCents(-500), "-$5.00");
  assert.equal(formatCents(-12345), "-$123.45");
});

test("formatCents sign mode marks gains explicitly", () => {
  assert.equal(formatCents(500, true), "+$5.00");
  assert.equal(formatCents(-500, true), "-$5.00");
  assert.equal(formatCents(0, true), "$0.00");
});

test("formatCents groups thousands", () => {
  assert.equal(formatCents(1143600), "$11,436.00");
});

test("parseDollarsToCents accepts the ways people type money", () => {
  assert.equal(parseDollarsToCents("60"), 6000);
  assert.equal(parseDollarsToCents("$60"), 6000);
  assert.equal(parseDollarsToCents("60.5"), 6050);
  assert.equal(parseDollarsToCents("60.25"), 6025);
  assert.equal(parseDollarsToCents("1,200.25"), 120025);
  assert.equal(parseDollarsToCents(" $ 15 "), 1500);
  assert.equal(parseDollarsToCents("0.05"), 5);
});

test("parseDollarsToCents rejects what it cannot represent", () => {
  assert.equal(parseDollarsToCents(""), null);
  assert.equal(parseDollarsToCents("   "), null);
  assert.equal(parseDollarsToCents("abc"), null);
  assert.equal(parseDollarsToCents("-5"), null);
  assert.equal(parseDollarsToCents("5.123"), null);
  assert.equal(parseDollarsToCents("1.2.3"), null);
  assert.equal(parseDollarsToCents("$"), null);
  assert.equal(parseDollarsToCents("Infinity"), null);
});

test("parseDollarsToCents never returns floats", () => {
  // 19.99 is the classic float trap: 19.99 * 100 === 1998.9999999999998.
  assert.equal(parseDollarsToCents("19.99"), 1999);
  assert.equal(parseDollarsToCents("0.29"), 29);
});
