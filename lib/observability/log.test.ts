import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { formatPerfEvent, perfLoggingEnabled, serverLog, setPerfSink } from "./log";

/**
 * Guards what may reach a log line — M8.8A.
 *
 * A performance log is a low-ceremony artifact: it gets tailed, piped into
 * `perf-baseline.ts`, and pasted into issues. The tests below are the reason
 * doing that is safe.
 */

test("an event serializes as one line of parseable JSON", () => {
  const line = formatPerfEvent({
    evt: "next.request",
    rid: "9f3c1a04b7e25d68-0",
    trace: "9f3c1a04b7e25d68",
    route: "/learn",
    ms: 12.3456,
    status: 200,
  });
  assert.equal(line.includes("\n"), false);
  const parsed = JSON.parse(line);
  assert.equal(parsed.evt, "next.request");
  assert.equal(parsed.route, "/learn");
  assert.equal(parsed.status, 200);
  // A tenth of a millisecond is all a shared clock is entitled to claim.
  assert.equal(parsed.ms, 12.3);
});

test("a non-finite duration is omitted, not written as null", () => {
  // JSON.stringify turns NaN into null, and null reads as 0 to anything
  // summing the column — a slow request silently becoming an instant one.
  for (const ms of [NaN, Infinity, -Infinity]) {
    const parsed = JSON.parse(
      formatPerfEvent({ evt: "next.read", rid: "a".repeat(8), trace: "a".repeat(8), route: "/", ms })
    );
    assert.equal("ms" in parsed, false, String(ms));
  }
});

test("CLS goes in `value`, never in `ms`", () => {
  const parsed = JSON.parse(
    formatPerfEvent({
      evt: "web.vital",
      rid: "a".repeat(8),
      trace: "a".repeat(8),
      route: "/",
      name: "CLS",
      value: 0.0412345,
    })
  );
  assert.equal("ms" in parsed, false);
  assert.equal(parsed.value, 0.041);
});

test("an error string is truncated", () => {
  const parsed = JSON.parse(
    formatPerfEvent({
      evt: "next.read",
      rid: "a".repeat(8),
      trace: "a".repeat(8),
      route: "/",
      error: "x".repeat(500),
    })
  );
  assert.equal(parsed.error.length, 120);
});

test("undefined optional fields do not appear at all", () => {
  const parsed = JSON.parse(
    formatPerfEvent({ evt: "web.nav", rid: "a".repeat(8), trace: "a".repeat(8), route: "/play" })
  );
  assert.deepEqual(Object.keys(parsed).sort(), ["evt", "rid", "route", "trace"]);
});

test("logging is opt-out in development and opt-in elsewhere", () => {
  assert.equal(perfLoggingEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv), true);
  assert.equal(perfLoggingEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv), false);
  assert.equal(
    perfLoggingEnabled({ NODE_ENV: "production", PERF_LOG: "1" } as NodeJS.ProcessEnv),
    true
  );
  assert.equal(
    perfLoggingEnabled({ NODE_ENV: "development", PERF_LOG: "0" } as NodeJS.ProcessEnv),
    false
  );
});

test("a throwing sink cannot fail the request being measured", () => {
  const previous = setPerfSink(() => {
    throw new Error("disk full");
  });
  const before = process.env.PERF_LOG;
  process.env.PERF_LOG = "1";
  try {
    assert.doesNotThrow(() =>
      serverLog({ evt: "next.request", rid: "a".repeat(8), trace: "a".repeat(8), route: "/" })
    );
  } finally {
    setPerfSink(previous);
    if (before === undefined) delete process.env.PERF_LOG;
    else process.env.PERF_LOG = before;
  }
});

test("nothing is emitted when logging is off", () => {
  const lines: string[] = [];
  const previous = setPerfSink((line) => lines.push(line));
  const before = process.env.PERF_LOG;
  process.env.PERF_LOG = "0";
  try {
    serverLog({ evt: "next.request", rid: "a".repeat(8), trace: "a".repeat(8), route: "/" });
    assert.deepEqual(lines, []);
  } finally {
    setPerfSink(previous);
    if (before === undefined) delete process.env.PERF_LOG;
    else process.env.PERF_LOG = before;
  }
});

test("the event shape has no field that could carry identity or a payload", () => {
  // Read from the module's own source, the technique
  // `lib/content/publicContent.test.ts` uses: a type is the enforcement, and
  // this is what makes widening it a deliberate act rather than an accident
  // during an urgent debugging session.
  const source = readFileSync(path.join(import.meta.dirname, "log.ts"), "utf8");
  const shape = /export interface PerfEvent \{([\s\S]*?)\n\}/.exec(source)?.[1];
  assert.ok(shape, "PerfEvent interface not found");

  const fields = [...shape.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual(
    fields.sort(),
    ["cold", "error", "evt", "ms", "name", "rid", "route", "status", "trace", "value"],
    "PerfEvent gained a field — is it identifying, unbounded, or user-supplied?"
  );

  // No open bag: `[key: string]` would defeat the whole check above.
  assert.equal(/\[\s*key\s*:\s*string\s*\]/.test(shape), false);

  for (const forbidden of ["user", "email", "token", "cookie", "auth", "body", "query", "url", "ip"]) {
    assert.ok(
      !fields.some((field) => field.toLowerCase().includes(forbidden)),
      `PerfEvent must not carry ${forbidden}`
    );
  }
});
