import assert from "node:assert/strict";
import { test } from "node:test";
import { unavailableCopy } from "./loadError";

/**
 * The old server-rendered path collapsed every failure into one panel that
 * said "the API may still be starting". These tests pin the distinctions that
 * replaced it, because the whole point of moving the read to the browser was
 * that the client API already knows which failure it was.
 */

test("an expired session offers a sign-in, not a retry", () => {
  const copy = unavailableCopy({ status: 401, message: "Your session expired." }, "today’s lesson");
  assert.equal(copy.action, "signin");
  assert.match(copy.title, /session/i);
  // Retrying a 401 just fails again — the panel must not invite it.
  assert.doesNotMatch(copy.detail, /try again/i);
});

test("a 403 is treated as an authorization problem too", () => {
  assert.equal(unavailableCopy({ status: 403 }, "table decision").action, "signin");
});

test("a 404 reads as an empty state and keeps the server's own explanation", () => {
  const copy = unavailableCopy(
    { status: 404, message: "no matching scenario found" },
    "authored hand",
  );
  assert.equal(copy.action, "retry");
  assert.match(copy.title, /No authored hand matched\./);
  assert.equal(copy.detail, "no matching scenario found");
});

test("a 404 with no detail still says something actionable", () => {
  const copy = unavailableCopy({ status: 404 }, "authored hand");
  assert.match(copy.detail, /filters/i);
});

test("a server error is retryable and capitalizes the subject", () => {
  const copy = unavailableCopy({ status: 503, message: "daily content is invalid" }, "daily lesson");
  assert.equal(copy.action, "retry");
  assert.equal(copy.title, "Daily lesson could not be loaded.");
  assert.equal(copy.detail, "daily content is invalid");
});

test("a network failure says so rather than blaming the server", () => {
  // A thrown TypeError from fetch carries no status at all.
  const copy = unavailableCopy(new TypeError("Failed to fetch"), "today’s lesson");
  assert.equal(copy.action, "retry");
  assert.match(copy.detail, /connection/i);
});

test("a non-object throw does not crash the panel", () => {
  for (const thrown of [undefined, null, "boom", 42]) {
    const copy = unavailableCopy(thrown, "table decision");
    assert.equal(copy.action, "retry");
    assert.ok(copy.title.length > 0 && copy.detail.length > 0);
  }
});

test("the subject is capitalized for display but taken lower case", () => {
  // Callers pass prose that also reads correctly mid-sentence in the 404 case.
  assert.equal(
    unavailableCopy({ status: 500 }, "table decision").title,
    "Table decision could not be loaded.",
  );
  assert.equal(unavailableCopy({ status: 404 }, "table decision").title, "No table decision matched.");
});
