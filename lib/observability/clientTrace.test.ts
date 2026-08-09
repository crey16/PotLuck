import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  __resetTraceForTest,
  adoptTrace,
  currentTraceId,
  nextRequestId,
  startNavigationTrace,
  traceHeaders,
} from "./clientTrace";
import { REQUEST_ID_HEADER, isValidRequestId, traceOf } from "./requestId";

/**
 * Guards the browser end of the trace — M8.8A.
 *
 * The browser is the only place that knows a page load and the six API calls
 * that follow it are one user action, because after M8.8C no server in this
 * app calls another. If this module forks the id, nothing joins anywhere.
 */

test.beforeEach(() => __resetTraceForTest());

test("the document's id is adopted, and its trace is what continues", () => {
  adoptTrace("9f3c1a04b7e25d68-0");
  const first = nextRequestId();
  const second = nextRequestId();
  assert.equal(first, "9f3c1a04b7e25d68-1");
  assert.equal(second, "9f3c1a04b7e25d68-2");
  // The whole point: three different requests, one join key.
  assert.equal(traceOf("9f3c1a04b7e25d68-0"), traceOf(first));
  assert.equal(traceOf(first), traceOf(second));
});

test("an id that arrived at a later hop still continues the same trace", () => {
  adoptTrace("9f3c1a04b7e25d68-7");
  assert.equal(traceOf(nextRequestId()), "9f3c1a04b7e25d68");
});

test("a malformed document id is ignored rather than adopted", () => {
  for (const bad of [null, undefined, "", "short", "bad id\nevt=x", "x".repeat(200)]) {
    __resetTraceForTest();
    adoptTrace(bad);
    const id = nextRequestId();
    assert.ok(isValidRequestId(id), id);
    assert.notEqual(traceOf(id), bad);
  }
});

test("a fetch before hydration mints its own trace rather than sending none", () => {
  const id = nextRequestId();
  assert.ok(isValidRequestId(id));
  assert.match(id, /^[0-9a-f]{16}-1$/);
});

test("a client navigation rolls the trace and resets the hop", () => {
  adoptTrace("9f3c1a04b7e25d68-0");
  nextRequestId();
  nextRequestId();
  const rolled = startNavigationTrace();
  assert.notEqual(rolled, "9f3c1a04b7e25d68");
  assert.equal(nextRequestId(), `${rolled}-1`);
});

test("traceHeaders sends exactly one header, and it is a valid id", () => {
  adoptTrace("9f3c1a04b7e25d68-0");
  const headers = traceHeaders();
  assert.deepEqual(Object.keys(headers), [REQUEST_ID_HEADER]);
  assert.ok(isValidRequestId(headers[REQUEST_ID_HEADER]));
});

test("consecutive calls never repeat an id", () => {
  adoptTrace("9f3c1a04b7e25d68-0");
  const ids = new Set(Array.from({ length: 200 }, () => nextRequestId()));
  assert.equal(ids.size, 200);
});

test("the hop wraps without ever producing an invalid id", () => {
  adoptTrace("9f3c1a04b7e25d68-0");
  for (let i = 0; i < 10_050; i += 1) {
    const id = nextRequestId();
    if (i % 977 === 0) assert.ok(isValidRequestId(id), `${i}: ${id}`);
  }
  assert.equal(traceOf(currentTraceId()), currentTraceId());
});

/**
 * Every browser→FastAPI call site must send the header. A helper that exists
 * and is not called is the most likely way this silently stops working, so the
 * check is against the call sites rather than against the helper.
 */
test("every client module that fetches /api sends the trace header", () => {
  const root = path.join(import.meta.dirname, "..");
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".test.")) continue;
      const source = readFileSync(full, "utf8");
      // A `fetch` at a path this app's FastAPI owns.
      if (!/fetch\(\s*(path|["'`]\/api\/)/.test(source)) continue;
      if (!source.includes("traceHeaders()")) offenders.push(path.relative(root, full));
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    `these modules call the API without joining the trace: ${offenders.join(", ")}`
  );
});
