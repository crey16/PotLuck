import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";

/**
 * Every text input must carry the shared `.input` class.
 *
 * This is not a style preference. iOS Safari zooms the page in when a text
 * input under 16px receives focus, and it never zooms back out — which made
 * every form in the product feel broken on a phone. The fix is a single rule
 * raising `.input` to 16px below 900px, and that rule only reaches controls
 * that actually wear the class.
 *
 * It matters because of exactly how the bug hid: `FriendsShell` and
 * `ProfileEditPanel` each carried a duplicated INLINE `inputStyle` with
 * `fontSize: 14`. Inline styles beat any stylesheet, so a CSS-only fix left
 * those two forms broken while looking fixed everywhere else. A CSS test
 * would not have caught it. This one does, because it checks the call sites.
 *
 * Radios and checkboxes are exempt: font-size is meaningless for them, a
 * 44px min-height would distort their layout, and their tap target is the
 * label. `OpponentToggle` and the `/system` swatches rely on that.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCAN = ["app", "components"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(target);
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [target];
  });
}

/**
 * The attribute text of each opening tag for the given elements.
 *
 * Scans to the tag's own closing `>`, tracking brace depth and quotes so a
 * `>` inside `onChange={(e) => ...}` or inside a string does not end it
 * early — which is the whole difficulty of reading JSX with a regex.
 */
function openingTags(src: string, tags: string[]): { tag: string; attrs: string }[] {
  const found: { tag: string; attrs: string }[] = [];
  for (const tag of tags) {
    const needle = `<${tag}`;
    let from = 0;
    for (;;) {
      const start = src.indexOf(needle, from);
      if (start === -1) break;
      // Reject `<inputs`-style false hits: the next char must end the name.
      const after = src[start + needle.length];
      if (after && /[A-Za-z0-9_-]/.test(after)) {
        from = start + needle.length;
        continue;
      }
      let i = start + needle.length;
      let depth = 0;
      let quote: string | null = null;
      while (i < src.length) {
        const ch = src[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
        } else if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) break;
        i++;
      }
      found.push({ tag, attrs: src.slice(start + needle.length, i) });
      from = i + 1;
    }
  }
  return found;
}

const EXEMPT_TYPES = ["radio", "checkbox", "range", "hidden", "file", "color"];

test("every text input carries the shared .input class", () => {
  const offenders: string[] = [];

  for (const dir of SCAN) {
    for (const file of tsxFiles(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const { tag, attrs } of openingTags(src, ["input", "textarea", "select"])) {
        const typeMatch = /type\s*=\s*"([^"]+)"/.exec(attrs);
        if (typeMatch && EXEMPT_TYPES.includes(typeMatch[1])) continue;
        if (/className\s*=\s*"[^"]*\binput\b/.test(attrs)) continue;
        offenders.push(`${path.relative(ROOT, file)}  <${tag}>`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These controls do not use the shared .input class:\n  ${offenders.join("\n  ")}\n\n` +
      "Without it the mobile rule raising inputs to 16px never reaches them, and\n" +
      "iOS Safari zooms the page in on focus and never zooms back — which is what\n" +
      "made every form feel broken before. Add className=\"input\"; if the control\n" +
      "genuinely needs different styling, extend .input rather than inlining a\n" +
      "font-size, because an inline style beats every stylesheet."
  );
});

/**
 * The other half of the same failure: a style object that sets a small
 * font-size on a control. Catches the shape the original bug had even if the
 * class is present, since inline wins.
 */
test("no inline style sets a sub-16px font on a form control", () => {
  const offenders: string[] = [];

  for (const dir of SCAN) {
    for (const file of tsxFiles(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const { tag, attrs } of openingTags(src, ["input", "textarea", "select"])) {
        const typeMatch = /type\s*=\s*"([^"]+)"/.exec(attrs);
        if (typeMatch && EXEMPT_TYPES.includes(typeMatch[1])) continue;

        // Inline on the tag itself.
        const inline = /fontSize\s*:\s*(\d+(?:\.\d+)?)/.exec(attrs);
        if (inline && Number(inline[1]) < 16) {
          offenders.push(`${path.relative(ROOT, file)}  <${tag}> fontSize: ${inline[1]}`);
          continue;
        }
        // Or via a style object referenced by name, e.g. `style={inputStyle}` —
        // the exact shape that hid this bug in two social components.
        const ref = /style\s*=\s*\{\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(attrs);
        if (!ref) continue;
        const decl = new RegExp(
          `(?:const|let|var)\\s+${ref[1]}\\s*[:=][\\s\\S]{0,400}?fontSize\\s*:\\s*(\\d+(?:\\.\\d+)?)`
        ).exec(src);
        if (decl && Number(decl[1]) < 16) {
          offenders.push(
            `${path.relative(ROOT, file)}  <${tag}> via \`${ref[1]}\` fontSize: ${decl[1]}`
          );
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Sub-16px font on a form control:\n  ${offenders.join("\n  ")}\n\n` +
      "An inline font-size beats the stylesheet, so the mobile 16px rule cannot\n" +
      "reach these. iOS Safari will zoom in on focus and stay zoomed."
  );
});

/** Guards the guards: if the scanner stops finding controls, both pass vacuously. */
test("the JSX scanner still finds the form controls it is policing", () => {
  const controls = SCAN.flatMap((dir) =>
    tsxFiles(path.join(ROOT, dir)).flatMap((file) =>
      openingTags(readFileSync(file, "utf8"), ["input", "textarea", "select"])
    )
  );
  assert.ok(
    controls.length >= 8,
    `found only ${controls.length} form controls; the codebase has known ones ` +
      "(auth, friends search, profile edit, opponent toggle) so the scanner has drifted"
  );
  // And it must be distinguishing exempt types, or the first test is toothless.
  const radios = controls.filter((c) => /type\s*=\s*"radio"/.test(c.attrs));
  assert.ok(radios.length >= 2, "expected the OpponentToggle radios to be recognised");
});
