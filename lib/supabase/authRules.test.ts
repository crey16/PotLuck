/**
 * Run with:  npx tsx --test lib/supabase/authRules.test.ts
 *
 * Pure redirect-decision logic, extracted from the middleware so it is
 * unit-testable without mocking cookies/Next.js request objects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRedirectToLogin, safeNext } from "./authRules";

test("shouldRedirectToLogin: protected paths redirect when signed out", () => {
  assert.equal(shouldRedirectToLogin("/drill/outs", false), true);
  assert.equal(shouldRedirectToLogin("/", false), true);
  assert.equal(shouldRedirectToLogin("/profile", false), true);
});

test("shouldRedirectToLogin: protected paths do not redirect when signed in", () => {
  assert.equal(shouldRedirectToLogin("/drill/outs", true), false);
  assert.equal(shouldRedirectToLogin("/", true), false);
});

test("shouldRedirectToLogin: /login never redirects", () => {
  assert.equal(shouldRedirectToLogin("/login", false), false);
  assert.equal(shouldRedirectToLogin("/login", true), false);
});

test("shouldRedirectToLogin: /auth/* never redirects", () => {
  assert.equal(shouldRedirectToLogin("/auth/callback", false), false);
  assert.equal(shouldRedirectToLogin("/auth/callback", true), false);
  assert.equal(shouldRedirectToLogin("/auth/anything/nested", false), false);
});

test("shouldRedirectToLogin: /api/* is left untouched", () => {
  assert.equal(shouldRedirectToLogin("/api/whatever", false), false);
  assert.equal(shouldRedirectToLogin("/api/whatever", true), false);
});

test("safeNext: accepts a same-origin relative path", () => {
  assert.equal(safeNext("/drill/outs"), "/drill/outs");
  assert.equal(safeNext("/profile?tab=1"), "/profile?tab=1");
});

test("safeNext: rejects absolute URLs", () => {
  assert.equal(safeNext("https://evil.com"), "/drill");
  assert.equal(safeNext("http://evil.com/path"), "/drill");
});

test("safeNext: rejects protocol-relative URLs", () => {
  assert.equal(safeNext("//evil.com"), "/drill");
  assert.equal(safeNext("//evil.com/path"), "/drill");
});

test("safeNext: rejects non-path-starting strings", () => {
  assert.equal(safeNext("evil.com"), "/drill");
  assert.equal(safeNext("javascript:alert(1)"), "/drill");
});

test("safeNext: rejects backslash open-redirect payloads", () => {
  // WHATWG URL parsing treats "\" as "/", so "/\evil.com" and "/\\evil.com"
  // both resolve to "https://evil.com/" once handed to the browser's URL
  // parser (e.g. via router.push). Neither starts with "//", so the old
  // check let them through — see CLAUDE.md-adjacent review notes.
  assert.equal(safeNext("/\\evil.com"), "/drill");
  assert.equal(safeNext("/\\\\evil.com"), "/drill");
});

test("safeNext: defaults to /drill for null/empty", () => {
  assert.equal(safeNext(null), "/drill");
  assert.equal(safeNext(""), "/drill");
});
