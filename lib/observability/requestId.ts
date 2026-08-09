/**
 * One logical id per traced request — M8.8A.
 *
 * ## The shape, and why it has two parts
 *
 * A request id here is `<trace>-<hop>`: a 16-hex-character trace and a small
 * decimal hop counter, e.g. `9f3c1a04b7e25d68-2`.
 *
 * The trace is what makes browser, Next and FastAPI lines about the same user
 * action join up. The hop is what keeps them distinguishable: a page load is
 * one document request plus N XHRs, and collapsing those into one identifier
 * would make "how long did this take" unanswerable — you would be summing
 * three different clocks under one key. Two parts means a log reader can group
 * by trace and still measure by hop.
 *
 * `traceOf()` is therefore the join key, and the full id is the row key.
 *
 * ## Why the trace is random, not derived
 *
 * It is 8 CSPRNG bytes. Deliberately NOT a user id, a session id, a token
 * hash, or a counter:
 *
 * - A user id as trace would put a stable identifier for a real person into
 *   every log line and into a response header the browser can read, which is
 *   the exact opposite of what a debugging aid should cost. It would also be
 *   useless as a join key, since every request that person ever makes shares
 *   it.
 * - A counter would let anyone holding one id guess the ids of requests around
 *   it, which matters here because the id is echoed in a response header and
 *   will end up pasted into bug reports.
 *
 * There is nothing to derive it from anyway: the id is minted before auth runs.
 *
 * ## Accepting an incoming id
 *
 * `resolveRequestId` takes whatever arrived in the header and either adopts it
 * or mints a fresh one. Adoption is what preserves one logical id across a
 * hop; validation is what stops the header from being a free write into the
 * log file. `isValidRequestId` is deliberately narrow — `[A-Za-z0-9_-]`, 8 to
 * 64 characters — so an id can never carry a newline (log-line injection), a
 * quote (breaking the JSON a reader parses), or an unbounded string (a
 * high-cardinality key and a memory cost in any aggregator).
 *
 * A rejected id is not an error: it is simply replaced. A caller that wants to
 * know which happened reads `generated`.
 */

/** The header this project carries the id in, request and response. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Characters, and length bounds, an accepted id may use. */
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The trace half of an id this module minted. */
const TRACE_CHARS = 16;

/**
 * Random hex from the platform CSPRNG. `globalThis.crypto` is present in
 * browsers, in Node 18+, and in the Edge runtime middleware runs on, so no
 * environment branch is needed — but a caller can inject bytes to test.
 */
export function newTraceId(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): string {
  const bytes = randomBytes(TRACE_CHARS / 2);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out.slice(0, TRACE_CHARS);
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** A complete id for hop `hop` of `trace`. Hops are clamped to 4 digits. */
export function requestIdFor(trace: string, hop: number): string {
  const safeHop = Number.isFinite(hop) ? Math.max(0, Math.floor(hop)) % 10000 : 0;
  return `${trace}-${safeHop}`;
}

/** A fresh id at hop 0 — a request that starts its own trace. */
export function newRequestId(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): string {
  return requestIdFor(newTraceId(randomBytes), 0);
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && VALID_REQUEST_ID.test(value);
}

/**
 * The join key: everything before the last `-`, or the whole id when it has
 * no hop suffix (an id that arrived from something other than this project).
 */
export function traceOf(requestId: string): string {
  const cut = requestId.lastIndexOf("-");
  if (cut <= 0) return requestId;
  const hop = requestId.slice(cut + 1);
  return /^\d{1,4}$/.test(hop) ? requestId.slice(0, cut) : requestId;
}

export interface ResolvedRequestId {
  requestId: string;
  trace: string;
  /** True when the incoming header was absent or rejected. */
  generated: boolean;
}

/**
 * Adopt a valid incoming id, or mint one. The single entry point for every
 * boundary that receives a request.
 */
export function resolveRequestId(
  incoming: string | null | undefined,
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): ResolvedRequestId {
  if (isValidRequestId(incoming)) {
    return { requestId: incoming, trace: traceOf(incoming), generated: false };
  }
  const trace = newTraceId(randomBytes);
  return { requestId: requestIdFor(trace, 0), trace, generated: true };
}
