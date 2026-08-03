import assert from "node:assert/strict";
import { test } from "node:test";

import { applyProfileUpdate, injectSelf, sortRows, type ProfileUpdate } from "./leaderboard";
import type { LeaderboardRow } from "./types";

function row(partial: Partial<LeaderboardRow> & { id: string }): LeaderboardRow {
  return {
    username: partial.id,
    display_name: null,
    level: 1,
    streak_count: 0,
    xp: 0,
    ...partial,
  };
}

test("sortRows orders by metric desc with xp then username tie-breaks", () => {
  const rows = [
    row({ id: "a", username: "zed", xp: 100, streak_count: 2 }),
    row({ id: "b", username: "amy", xp: 300, streak_count: 1 }),
    row({ id: "c", username: "Bob", xp: 100, streak_count: 2 }),
  ];
  assert.deepEqual(
    sortRows(rows, "xp").map((r) => r.id),
    ["b", "c", "a"] // 300 first; 100-tie broken by username, Bob < zed
  );
  assert.deepEqual(
    sortRows(rows, "streak").map((r) => r.id),
    ["c", "a", "b"] // streak 2 first; tie xp equal → username; then streak 1
  );
});

test("applyProfileUpdate re-ranks an existing row and reports the mover", () => {
  const rows = sortRows(
    [row({ id: "a", username: "amy", xp: 200 }), row({ id: "b", username: "bob", xp: 100 })],
    "xp"
  );
  const update: ProfileUpdate = { id: "b", xp: 300, streak_count: 4, level: 4, is_public: true };
  const result = applyProfileUpdate(rows, update, "xp");
  assert.deepEqual(result.rows.map((r) => r.id), ["b", "a"]);
  assert.equal(result.rows[0].xp, 300);
  assert.equal(result.rows[0].streak_count, 4);
  assert.equal(result.movedId, "b");
});

test("applyProfileUpdate ignores ids outside the scope", () => {
  const rows = [row({ id: "a", username: "amy", xp: 200 })];
  const update: ProfileUpdate = { id: "x", xp: 999, streak_count: 0, level: 10, is_public: true };
  const result = applyProfileUpdate(rows, update, "xp", new Set(["a"]));
  assert.deepEqual(result.rows.map((r) => r.id), ["a"]);
  assert.equal(result.movedId, null);
});

test("applyProfileUpdate adds an in-scope id not yet on the board", () => {
  const rows = [row({ id: "a", username: "amy", xp: 200 })];
  const update: ProfileUpdate = {
    id: "f",
    username: "fred",
    xp: 500,
    streak_count: 1,
    level: 6,
    is_public: true,
  };
  const result = applyProfileUpdate(rows, update, "xp", new Set(["a", "f"]));
  assert.deepEqual(result.rows.map((r) => r.id), ["f", "a"]);
});

test("applyProfileUpdate removes a row that went private (unscoped/global board)", () => {
  const rows = [
    row({ id: "a", username: "amy", xp: 200 }),
    row({ id: "b", username: "bob", xp: 100 }),
  ];
  const update: ProfileUpdate = { id: "a", xp: 200, streak_count: 0, level: 3, is_public: false };
  const result = applyProfileUpdate(rows, update, "xp");
  assert.deepEqual(result.rows.map((r) => r.id), ["b"]);
  assert.equal(result.movedId, null);
});

test("a private friend stays on a scoped (friends) board", () => {
  const rows = [row({ id: "a", username: "amy", xp: 200 })];
  const update: ProfileUpdate = { id: "a", xp: 250, streak_count: 1, level: 3, is_public: false };
  const result = applyProfileUpdate(rows, update, "xp", new Set(["a"]));
  assert.deepEqual(result.rows.map((r) => r.id), ["a"]);
  assert.equal(result.rows[0].xp, 250);
});

test("injectSelf adds a missing self row marked unranked, keeps present self untouched", () => {
  const self = row({ id: "me", username: "me", xp: 50 });
  const withMissing = injectSelf([row({ id: "a", username: "amy", xp: 200 })], self, "xp");
  assert.equal(withMissing.length, 2);
  const injected = withMissing.find((r) => r.id === "me");
  assert.ok(injected);
  assert.equal(injected.unranked, true);

  const already = injectSelf([self, row({ id: "a", username: "amy", xp: 200 })], self, "xp");
  assert.equal(already.filter((r) => r.id === "me").length, 1);
  assert.equal(already.find((r) => r.id === "me")?.unranked, undefined);
});
