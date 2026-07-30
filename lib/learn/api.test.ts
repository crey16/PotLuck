import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonAttemptBody, lessonCompleteBody } from "./api";

test("lesson attempt body never accepts a client correctness flag", () => {
  const body = lessonAttemptBody(4, 2, "b");
  assert.deepEqual(body, { lesson_id: 4, screen_index: 2, selected_choice_id: "b" });
  assert.equal("is_correct" in body, false);
});

test("lesson completion never trusts a browser-computed score", () => {
  assert.deepEqual(lessonCompleteBody(4), { lesson_id: 4 });
  assert.equal("score" in lessonCompleteBody(4), false);
});
