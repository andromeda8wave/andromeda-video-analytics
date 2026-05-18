import assert from "node:assert/strict";
import test from "node:test";

import { safeFileStem } from "../src/fs.ts";
import { extractYouTubeId } from "../src/youtube.ts";

test("extractYouTubeId supports common YouTube URL shapes", () => {
  assert.equal(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"),
    "dQw4w9WgXcQ"
  );
  assert.equal(extractYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("safeFileStem makes readable filesystem-safe stems", () => {
  assert.equal(safeFileStem("03 — Планирование дня.mov"), "03-Планирование-дня");
  assert.equal(safeFileStem("   a/b:c*?<>|  "), "a-b-c");
  assert.equal(safeFileStem("..."), "video");
});
