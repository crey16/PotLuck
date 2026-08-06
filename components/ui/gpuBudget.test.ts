import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";

/**
 * The GPU-budget guard.
 *
 * On 2026-08-05 the site **did not load at all** on iPhone Safari. Not slow,
 * not ugly — the tab hung and never finished, with nothing in any log,
 * because `filter: blur()` allocates an offscreen GPU buffer per layer and
 * iOS Safari has a hard per-tab budget for them. `/login` was asking for
 * fourteen simultaneous blurred layers plus the header's `backdrop-filter`.
 *
 * The fix was to swap the blurs for radial gradients below 900px. CLAUDE.md
 * records the incident and then says the quiet part: "nothing currently
 * prevents it recurring." This is that prevention.
 *
 * **The invariant:** every selector that turns a blur ON outside a
 * small-viewport media query must be turned OFF inside one. A new decorative
 * blur is fine on desktop and must be explicitly neutralised for phones — by
 * `display: none`, `filter: none`, or `backdrop-filter: none`.
 *
 * This is a structural check on the stylesheet rather than a render test
 * because the failure mode is a *hang*, not a wrong pixel: there is nothing
 * to screenshot and nothing to assert against at runtime. The only reliable
 * moment to catch it is before it ships.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CSS = path.join(ROOT, "app/globals.css");

/** The breakpoint below which blurs must be gone. */
const PHONE_MAX_WIDTH = 900;

interface Rule {
  selectors: string[];
  body: string;
  /** max-width in px of the nearest enclosing media query, or null. */
  mediaMaxWidth: number | null;
}

/**
 * A deliberately small CSS reader: strip comments, then walk brace depth
 * tracking the current `@media` condition. Enough for a hand-written
 * stylesheet, and it fails loudly rather than silently if the shape changes —
 * see the sanity test at the bottom.
 */
function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const atStack: (number | null)[] = [];
  let buffer = "";
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = buffer.trim();
      buffer = "";
      if (prelude.startsWith("@")) {
        // A nested block (@media, @container, @supports). Record its
        // max-width if it has one; @container counts too, since a container
        // query on a phone-width container is equally a phone guard.
        const m = /max-width:\s*(\d+)px/.exec(prelude);
        atStack.push(m ? Number(m[1]) : null);
        i++;
        continue;
      }
      // A style rule: capture to its closing brace.
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        if (depth > 0) j++;
      }
      const body = src.slice(i + 1, j);
      const enclosing = [...atStack].reverse().find((v) => v !== null) ?? null;
      rules.push({
        selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean),
        body,
        mediaMaxWidth: enclosing,
      });
      i = j + 1;
      continue;
    }
    if (ch === "}") {
      atStack.pop();
      buffer = "";
      i++;
      continue;
    }
    buffer += ch;
    i++;
  }
  return rules;
}

/** Does this declaration block switch a blur ON? */
const enablesBlur = (body: string): boolean =>
  /(^|[\s;])(-webkit-)?backdrop-filter\s*:\s*(?!none)[^;]*blur\(/.test(body) ||
  /(^|[\s;])filter\s*:\s*(?!none)[^;]*blur\(/.test(body);

/** Does this block switch it OFF, or remove the element entirely? */
const disablesBlur = (body: string): boolean =>
  /(^|[\s;])(-webkit-)?backdrop-filter\s*:\s*none/.test(body) ||
  /(^|[\s;])filter\s*:\s*none/.test(body) ||
  /(^|[\s;])display\s*:\s*none/.test(body) ||
  /(^|[\s;])content-visibility\s*:\s*hidden/.test(body);

/**
 * `.auth-mesh i` covers `.auth-mesh i:nth-child(7)` — the disable targets the
 * same elements, more broadly. Prefix matching is the cheap version of that
 * and is sound in the direction that matters: it can only ever accept a
 * *broader* disable, never a narrower one.
 */
const isCoveredBy = (blurSelector: string, disableSelector: string): boolean =>
  blurSelector === disableSelector || blurSelector.startsWith(disableSelector + ":");

test("every blur is switched off at phone width", () => {
  const rules = parseRules(readFileSync(CSS, "utf8"));

  const blurred = rules
    .filter((r) => enablesBlur(r.body))
    .filter((r) => r.mediaMaxWidth === null || r.mediaMaxWidth > PHONE_MAX_WIDTH)
    .flatMap((r) => r.selectors);

  const disabled = rules
    .filter((r) => r.mediaMaxWidth !== null && r.mediaMaxWidth <= PHONE_MAX_WIDTH)
    .filter((r) => disablesBlur(r.body))
    .flatMap((r) => r.selectors);

  const unguarded = blurred.filter(
    (sel) => !disabled.some((off) => isCoveredBy(sel, off))
  );

  assert.deepEqual(
    unguarded,
    [],
    `These selectors blur on a phone:\n  ${unguarded.join("\n  ")}\n\n` +
      "iOS Safari allocates an offscreen GPU buffer per blurred layer and has a\n" +
      "hard per-tab budget. Exceeding it does not error — the tab simply never\n" +
      "finishes loading, which is how the whole site broke on 2026-08-05.\n" +
      `Disable each one inside a @media (max-width: ${PHONE_MAX_WIDTH}px) block\n` +
      "with display:none, filter:none or backdrop-filter:none. A radial gradient\n" +
      "looks near-identical at these opacities and costs no buffer at all."
  );
});

/**
 * The count is not itself the bug — one blur is fine, fourteen is not — but a
 * sharp rise is the shape the incident had, and a ceiling turns "someone
 * added a nice glow to six elements" into a conversation rather than an
 * outage.
 */
test("the desktop blur budget has not quietly grown", () => {
  const rules = parseRules(readFileSync(CSS, "utf8"));
  const layers = rules
    .filter((r) => enablesBlur(r.body))
    .filter((r) => r.mediaMaxWidth === null || r.mediaMaxWidth > PHONE_MAX_WIDTH)
    .reduce((n, r) => n + r.selectors.length, 0);

  // 4 today: .ambient-wash i, .auth-mesh i, .auth-mesh i:nth-child(7),
  // .site-header. Raise this deliberately, with a reason, never reflexively.
  assert.ok(
    layers <= 6,
    `${layers} selectors apply a blur on desktop (budget 6). Each is an ` +
      "offscreen GPU buffer; the 2026-08-05 outage was fourteen of them."
  );
});

/**
 * Guards the guard. If the stylesheet stops matching the shape this reader
 * assumes, the checks above would pass by finding nothing at all — the most
 * dangerous way for a test to fail.
 */
test("the CSS reader still finds the blurs it is supposed to police", () => {
  const rules = parseRules(readFileSync(CSS, "utf8"));
  assert.ok(rules.length > 300, `only parsed ${rules.length} rules — reader is broken`);

  const blurRules = rules.filter((r) => enablesBlur(r.body));
  assert.ok(
    blurRules.length >= 3,
    `found only ${blurRules.length} blur rules; the stylesheet has known ones ` +
      "(.ambient-wash i, .auth-mesh i, .site-header) so the matcher has drifted"
  );

  const guards = rules.filter(
    (r) => r.mediaMaxWidth !== null && r.mediaMaxWidth <= PHONE_MAX_WIDTH && disablesBlur(r.body)
  );
  assert.ok(guards.length >= 2, `found only ${guards.length} phone-side blur guards`);
});
