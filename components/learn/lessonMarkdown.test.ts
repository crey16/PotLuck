import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdownBlocks } from "./LessonMarkdown";

test("lesson markdown parses headings, lists, paragraphs, and tables", () => {
  const blocks = parseMarkdownBlocks(
    "## Title\n\nA **strong** idea.\n\n- One\n- Two\n\n| Draw | Outs |\n|---|---|\n| Flush | 9 |"
  );
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "unordered", "table"]);
  assert.deepEqual(blocks[3], {
    type: "table",
    headers: ["Draw", "Outs"],
    rows: [["Flush", "9"]],
  });
});

test("raw HTML stays paragraph text instead of becoming an HTML block", () => {
  assert.deepEqual(parseMarkdownBlocks("<script>alert(1)</script>"), [
    { type: "paragraph", lines: ["<script>alert(1)</script>"] },
  ]);
});
