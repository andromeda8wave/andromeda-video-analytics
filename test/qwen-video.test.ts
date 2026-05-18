import assert from "node:assert/strict";
import test from "node:test";

import { buildVideoContentPart } from "../src/qwen-video.ts";

test("buildVideoContentPart uses OpenRouter fetch video_url wire format", () => {
  const part = buildVideoContentPart("data:video/mp4;base64,abc");

  assert.equal(part.type, "video_url");
  assert.deepEqual(part.video_url, { url: "data:video/mp4;base64,abc" });
  assert.equal("videoUrl" in part, false);
});
