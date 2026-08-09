/**
 * Collect and summarize a performance baseline — M8.8A.
 *
 * Two modes, deliberately separate, because they answer different questions
 * and have very different claims to authority.
 *
 * ## `probe` — drive HTTP and time it from outside
 *
 *   npx tsx scripts/perf-baseline.ts probe --base http://localhost:3000 -n 30
 *
 * Requests each route N times and reports TTFB and total transfer. This is the
 * only number in this project that measures **what a user waits for end to
 * end**: it contains middleware, the Next render, every server read inside it,
 * and the bytes on the wire. Everything the server logs about itself is a
 * decomposition of this, never an addition to it.
 *
 * Three things it does that a `curl` loop in a shell does not:
 *
 * - **Separates first-hit from warm.** The first request to a route pays for
 *   route compilation (dev), module load and connection setup. Those are real
 *   costs and they are reported — on their own line, labelled `first`, never
 *   pooled into the warm distribution. A p95 with one cold sample in it
 *   describes neither state.
 * - **Follows no redirects.** `redirect: "manual"`, so `/` answering 307 to
 *   `/login` is recorded as a 307 on `/`. Following it would silently time
 *   `/login` and file the result under `/`, which is the single easiest way to
 *   produce a baseline that says the dashboard is fast when it was never
 *   rendered.
 * - **Verifies the trace propagated.** Every probe sends an `x-request-id` and
 *   checks the response echoes the same one. A run where propagation broke
 *   reports it rather than quietly losing the join.
 *
 * ## `ingest` — summarize what the servers logged
 *
 *   PERF_LOG=1 npm run dev > perf.jsonl
 *   npx tsx scripts/perf-baseline.ts ingest perf.jsonl
 *
 * Reads the JSON lines `lib/observability/log.ts` and `api/observability.py`
 * emit — both halves, one parser — and groups them. This is where per-endpoint
 * FastAPI latency, per-read-group server time, Web Vitals and route
 * transitions come from.
 *
 * **The file is the aggregation, not a process's memory.** That is on purpose:
 * a serverless deployment has many short-lived instances, so anything counting
 * in RAM would report one instance's view and call it the system's. A log line
 * survives the instance that wrote it, and `ingest` is a pure function of the
 * file — the same file summarizes identically forever, which is what makes a
 * baseline something you can be held to.
 *
 * ## What it will not do
 *
 * It will not print a p95 from four samples. `lib/observability/stats.ts`
 * refuses below five, marks p95 unreliable below twenty, and this renderer
 * prints that judgement in a column rather than burying it.
 *
 * ## Authentication
 *
 * `--cookie-file <path>` supplies a browser `Cookie:` header so the signed-in
 * routes can be measured. **Without it the signed-in routes are not measured**
 * — they answer a 307 to `/login`, and the report says `307` rather than
 * pretending otherwise.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  formatBytes,
  formatMs,
  groupSamples,
  summarize,
  type GroupReport,
  type Sample,
  type Summary,
} from "../lib/observability/stats";
import { CONFIDENCE_NOTE } from "../lib/observability/log";
import { newRequestId } from "../lib/observability/requestId";

/** Routes probed by default — the set M8.8A names, plus the signed-out door. */
const DEFAULT_ROUTES = [
  "/",
  "/login",
  "/learn",
  "/daily",
  "/learn/practice",
  "/learn/table",
  "/drill",
  "/play",
  "/play/history",
  "/ranges",
  "/leaderboard",
  "/reference",
];

interface Args {
  mode: "probe" | "ingest";
  base: string;
  routes: string[];
  n: number;
  file: string | null;
  cookie: string | null;
  json: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "probe",
    base: process.env.PERF_BASE_URL ?? "http://localhost:3000",
    routes: DEFAULT_ROUTES,
    n: 20,
    file: null,
    cookie: null,
    json: false,
    out: null,
  };
  const rest = [...argv];
  if (rest[0] === "probe" || rest[0] === "ingest") args.mode = rest.shift() as Args["mode"];

  while (rest.length) {
    const flag = rest.shift()!;
    switch (flag) {
      case "--base":
        args.base = rest.shift() ?? args.base;
        break;
      case "-n":
      case "--n":
        args.n = Math.max(1, Number(rest.shift() ?? args.n));
        break;
      case "--routes":
        args.routes = (rest.shift() ?? "").split(",").map((r) => r.trim()).filter(Boolean);
        break;
      case "--cookie-file":
        args.cookie = readFileSync(rest.shift()!, "utf8").trim();
        break;
      case "--json":
        args.json = true;
        break;
      case "--out":
        args.out = rest.shift() ?? null;
        break;
      default:
        if (args.mode === "ingest" && !args.file && !flag.startsWith("-")) args.file = flag;
        break;
    }
  }
  return args;
}

/* ------------------------------------------------------------------ probe */

interface ProbeResult extends Sample {
  /** Time to first byte — headers received. */
  ttfb: number;
  /** True when the response echoed the request id we sent. */
  traced: boolean;
}

async function probeOnce(
  base: string,
  route: string,
  cookie: string | null,
  first: boolean
): Promise<ProbeResult> {
  const requestId = newRequestId();
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (cookie) headers.cookie = cookie;

  const started = performance.now();
  try {
    const response = await fetch(new URL(route, base), {
      headers,
      // Never followed — see the module note. A redirect is an outcome, and
      // timing the place it points to under the name of the place it came
      // from is how a baseline learns to lie.
      redirect: "manual",
    });
    // `fetch` resolves when the headers land, so this is TTFB.
    const ttfb = performance.now() - started;
    const body = await response.arrayBuffer();
    const total = performance.now() - started;
    return {
      key: route,
      ms: total,
      ttfb,
      status: response.status,
      bytes: body.byteLength,
      cold: first,
      // A 5xx is a failure. A 3xx is not — it is a real outcome of a real
      // request, counted in the status column so a signed-out run cannot be
      // mistaken for a signed-in one.
      failed: response.status >= 500,
      traced: response.headers.get("x-request-id") === requestId,
    };
  } catch {
    return {
      key: route,
      ms: performance.now() - started,
      ttfb: performance.now() - started,
      status: undefined,
      cold: first,
      failed: true,
      traced: false,
    };
  }
}

async function probe(args: Args) {
  const results: ProbeResult[] = [];
  for (const route of args.routes) {
    for (let i = 0; i < args.n; i += 1) {
      // Sequential, not concurrent. Concurrency here would measure this
      // machine's ability to saturate a dev server, which is a different
      // question with a different answer.
      results.push(await probeOnce(args.base, route, args.cookie, i === 0));
    }
    process.stderr.write(`  probed ${route} ×${args.n}\n`);
  }
  return results;
}

/* ----------------------------------------------------------------- ingest */

export interface LogLine {
  evt?: string;
  rid?: string;
  trace?: string;
  route?: string;
  name?: string;
  ms?: number;
  value?: number;
  status?: number;
  cold?: boolean;
  method?: string;
  error?: string;
}

/**
 * Parse a log stream. Non-JSON lines are skipped without comment — the file is
 * usually a whole dev-server stdout with Next's own banners in it, and refusing
 * to read that would make the tool useless for the one thing it is for.
 */
export function parseLogLines(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && typeof parsed.evt === "string") {
        out.push(parsed as LogLine);
      }
    } catch {
      // Not one of ours.
    }
  }
  return out;
}

/**
 * Turn log lines into samples, keyed by what makes each event comparable.
 *
 * The key includes the event kind, so a FastAPI endpoint and a Next read group
 * that happen to share a name can never land in one row. CLS is excluded from
 * latency entirely — it is not a duration, and `stats.ts` would happily compute
 * a "p95 of 0.03ms" for it.
 */
export function samplesFromLogs(lines: LogLine[]): Sample[] {
  const samples: Sample[] = [];
  for (const line of lines) {
    const label =
      line.evt === "api.request"
        ? `api ${line.method ?? "?"} ${line.route ?? "?"}`
        : line.evt === "next.request"
          ? `next.doc ${line.route ?? "?"}`
          : line.evt === "next.read"
            ? `read ${line.name ?? "?"}`
            : line.evt === "web.vital"
              ? `vital ${line.name ?? "?"} ${line.route ?? "?"}`
              : line.evt === "web.nav"
                ? `nav ${line.route ?? "?"} (${line.name ?? "?"})`
                : null;
    if (!label) continue;
    if (typeof line.ms !== "number") continue;
    samples.push({
      key: label,
      ms: line.ms,
      status: line.status,
      cold: line.cold === true,
      failed:
        (typeof line.status === "number" && line.status >= 500) || Boolean(line.error),
    });
  }
  return samples;
}

/** CLS lines carry `value`, not `ms`, so they are summarized on their own. */
export function clsSummary(lines: LogLine[]): Map<string, Summary> {
  const byRoute = new Map<string, number[]>();
  for (const line of lines) {
    if (line.evt !== "web.vital" || line.name !== "CLS") continue;
    if (typeof line.value !== "number") continue;
    const key = line.route ?? "?";
    const list = byRoute.get(key);
    if (list) list.push(line.value);
    else byRoute.set(key, [line.value]);
  }
  const out = new Map<string, Summary>();
  for (const [key, values] of byRoute) out.set(key, summarize(values));
  return out;
}

/* ------------------------------------------------------------------ print */

function pad(value: string, width: number, right = false): string {
  if (value.length >= width) return value;
  const fill = " ".repeat(width - value.length);
  return right ? fill + value : value + fill;
}

function printTable(title: string, reports: GroupReport[]) {
  if (reports.length === 0) return;
  const keyWidth = Math.max(20, ...reports.map((r) => r.key.length));
  console.log(`\n${title}`);
  console.log(
    [
      pad("key", keyWidth),
      pad("n", 5, true),
      pad("p50", 9, true),
      pad("p95", 9, true),
      pad("max", 9, true),
      pad("err", 7, true),
      pad("bytes", 9, true),
      "confidence",
    ].join("  ")
  );
  console.log("-".repeat(keyWidth + 62));
  for (const report of reports) {
    const w = report.warm;
    console.log(
      [
        pad(report.key, keyWidth),
        pad(String(w.n), 5, true),
        pad(formatMs(w.p50), 9, true),
        // The star is not decoration: it marks a p95 that cannot differ from
        // the maximum at this sample size, so nobody quotes it as a tail.
        pad(formatMs(w.p95) + (w.p95Reliable ? "" : "*"), 9, true),
        pad(formatMs(w.max), 9, true),
        pad(report.failures ? `${(report.errorRate * 100).toFixed(0)}%` : "0", 7, true),
        pad(formatBytes(report.bytes.p50), 9, true),
        CONFIDENCE_NOTE[w.confidence],
      ].join("  ")
    );
    // "none" is an event that has no status at all (a read group, a vital) —
    // reporting it as a non-200 would read as a failure that never happened.
    const statuses = Object.entries(report.statuses).filter(
      ([s]) => s !== "200" && s !== "none"
    );
    if (statuses.length) {
      console.log(
        `${pad("", keyWidth)}  ↳ non-200: ${statuses.map(([s, c]) => `${s}×${c}`).join(", ")}`
      );
    }
    if (report.cold.n > 0) {
      console.log(
        `${pad("", keyWidth)}  ↳ first hit (n=${report.cold.n}): ${formatMs(report.cold.p50 ?? report.cold.max)}` +
          ` — reported apart from warm, never pooled`
      );
    }
  }
  console.log("\n* p95 equals max at n<20 — a sample size, not a tail.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "ingest") {
    if (!args.file) {
      console.error("usage: perf-baseline.ts ingest <logfile.jsonl>");
      process.exit(1);
    }
    const lines = parseLogLines(readFileSync(args.file, "utf8"));
    const samples = samplesFromLogs(lines);
    const reports = groupSamples(samples);
    if (args.json || args.out) {
      const payload = JSON.stringify({ source: args.file, lines: lines.length, reports }, null, 2);
      if (args.out) writeFileSync(args.out, payload);
      if (args.json) console.log(payload);
      if (!args.json) console.error(`wrote ${args.out}`);
      return;
    }
    console.log(`Ingested ${lines.length} instrumented lines from ${args.file}`);
    printTable("Server + browser events (ms)", reports);
    const cls = clsSummary(lines);
    if (cls.size) {
      console.log("\nCLS (unitless, never a duration)");
      for (const [route, summary] of cls) {
        console.log(
          `  ${pad(route, 28)} n=${pad(String(summary.n), 4, true)}  p50=${summary.p50?.toFixed(3) ?? "—"}  p95=${summary.p95?.toFixed(3) ?? "—"}`
        );
      }
    }
    return;
  }

  console.error(`Probing ${args.base} — ${args.routes.length} routes × ${args.n}`);
  const results = await probe(args);
  const reports = groupSamples(results);

  // TTFB is summarized separately from total: they answer different questions
  // (when does content start arriving vs when is it all here) and a single
  // column would hide a route that streams fast and finishes slowly.
  const ttfbReports = groupSamples(
    results.map((r) => ({ ...r, ms: r.ttfb }))
  );

  const untraced = results.filter((r) => !r.traced && !r.failed).length;

  if (args.json || args.out) {
    const payload = JSON.stringify(
      { base: args.base, n: args.n, untraced, total: reports, ttfb: ttfbReports },
      null,
      2
    );
    if (args.out) writeFileSync(args.out, payload);
    if (args.json) console.log(payload);
    else console.error(`wrote ${args.out}`);
    return;
  }

  printTable("Time to first byte", ttfbReports);
  printTable("Total (headers + body)", reports);
  console.log(
    untraced === 0
      ? "\nRequest id echoed on every successful response."
      : `\n!! ${untraced} successful responses did NOT echo x-request-id — propagation is broken.`
  );
}

// Run only when this file IS the entry point, so `perf-baseline.test.ts` can
// import the parsers above without launching a probe run. Compared on the
// resolved path rather than `import.meta.url`, which `tsx --test` compiles to
// CommonJS where it does not exist.
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filenameOrSelf())) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

/** The path of this module, in whichever module format it was compiled to. */
function __filenameOrSelf(): string {
  return typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
}
