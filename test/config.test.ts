import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.ts";

test("loadConfig resolves relative path settings against the project root", () => {
  const root = path.join(path.sep, "tmp", "video-analyst-skill");
  const config = loadConfig(root, {
    whisperBin: "./bin/whisper-cli",
    whisperModel: "./models/ggml-large-v3.bin",
    ffmpegBin: "ffmpeg",
    ffprobeBin: "./bin/ffprobe",
    youtubeOAuthTokenPath: ".system/youtube-oauth-token.json"
  });

  assert.equal(config.whisperBin, path.join(root, "bin", "whisper-cli"));
  assert.equal(config.whisperModel, path.join(root, "models", "ggml-large-v3.bin"));
  assert.equal(config.ffmpegBin, "ffmpeg");
  assert.equal(config.ffprobeBin, path.join(root, "bin", "ffprobe"));
  assert.equal(config.youtubeOAuthTokenPath, path.join(root, ".system", "youtube-oauth-token.json"));
});
