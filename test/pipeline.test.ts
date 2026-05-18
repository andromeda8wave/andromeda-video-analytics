import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertModelSupportsVideo } from "../src/openrouter.ts";
import { analyzeVideos } from "../src/pipeline.ts";
import type { PipelineDependencies, RawTranscriptArtifact } from "../src/types.ts";
import { fetchYouTubeAnalytics } from "../src/youtube.ts";

test("fetchYouTubeAnalytics skips cleanly when OAuth is not configured", async () => {
  const result = await fetchYouTubeAnalytics({
    root: await mkdtemp(path.join(os.tmpdir(), "video-analytics-")),
    youtubeId: "dQw4w9WgXcQ",
    startDate: "2026-05-01",
    endDate: "2026-05-16",
    oauthClientId: "",
    oauthClientSecret: ""
  });

  assert.equal(result.analytics_api_status, "skipped_missing_oauth");
});

test("assertModelSupportsVideo rejects text-only models", () => {
  assert.throws(
    () =>
      assertModelSupportsVideo({
        id: "text/model",
        architecture: { input_modalities: ["text"] }
      }),
    /does not support video input/
  );
});

test("analyzeVideos writes MVP artifacts using injected runtime dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "video-analytics-"));
  const videoPath = path.join(root, "fixtures", "sample.mp4");
  await mkdir(path.dirname(videoPath), { recursive: true });
  await writeFile(videoPath, Buffer.from("fake video"));

  const transcript: RawTranscriptArtifact = {
    schema_version: "1.0.0",
    source_id: "source-1",
    original_filename: "sample.mp4",
    language: "ru",
    model_id: "test-asr",
    generated_at: "2026-05-16T00:00:00.000Z",
    segments: [{ start_ms: 0, end_ms: 1000, text: "Привет." }],
    provenance: {
      audio_path: ".system/run/audio.wav",
      generated_by: "video-analytics",
      normalization: { runtime: "ffmpeg", binary: "ffmpeg", args: [] },
      asr: { runtime: "test", binary: "test", model: "test", args: [] }
    }
  };

  const dependencies: PipelineDependencies = {
    now: () => new Date("2026-05-16T01:02:03.000Z"),
    randomId: () => "abcdef",
    probeVideo: async () => ({
      duration_ms: 1000,
      width: 1280,
      height: 720,
      video_codec: "h264",
      audio_codec: "aac",
      raw: { ok: true }
    }),
    extractAudio: async (_video, audioPath) => {
      await writeFile(audioPath, Buffer.from("wav"));
    },
    transcribe: async () => transcript,
    analyzeVisuals: async () => ({
      status: "completed",
      model: "qwen/test",
      prompt: "prompt",
      content: "00:00-00:01: тестовый кадр.",
      request: { model: "qwen/test" },
      response: { choices: [{ message: { content: "00:00-00:01: тестовый кадр." } }] }
    }),
    fetchYouTubeData: async () => ({
      youtube_id: "dQw4w9WgXcQ",
      data_api_status: "skipped_missing_api_key",
      data_api: { data_api_status: "skipped_missing_api_key" }
    }),
    fetchYouTubeAnalytics: async () => ({
      analytics_api_status: "skipped_missing_oauth",
      analytics_api: { analytics_api_status: "skipped_missing_oauth" }
    }),
    fetchYouTubeBundle: async () => ({
      youtube_id: "dQw4w9WgXcQ",
      data_api_status: "completed",
      analytics_api_status: "completed",
      thumbnail_ctr_status: "unsupported_by_youtube_analytics_api",
      statuses: {
        video: "completed",
        channel: "completed",
        latest_uploads: "completed",
        comments: "completed",
        captions: "completed",
        analytics: "completed",
        analytics_summary: "completed",
        analytics_daily: "completed",
        analytics_retention: "completed",
        thumbnail_ctr: "unsupported_by_youtube_analytics_api"
      },
      video: { status: "completed", data: { items: [] } },
      channel: { status: "completed", data: { items: [] } },
      latest_uploads: { status: "completed", data: { items: [] } },
      comments: { status: "completed", data: { items: [] } },
      captions: { status: "completed", data: { items: [] } },
      analytics: {
        status: "completed",
        summary: { status: "completed", data: { rows: [[1]] } },
        daily: { status: "completed", data: { rows: [] } },
        retention: { status: "completed", data: { rows: [] } },
        thumbnail_ctr_status: "unsupported_by_youtube_analytics_api"
      },
      data_api: { items: [] },
      analytics_api: { rows: [[1]] }
    })
  };

  const result = await analyzeVideos(
    [{ video_path: videoPath, youtube_id: "dQw4w9WgXcQ", title: "Sample Fixture" }],
    { root, config: { youtubeApiKey: "", openRouterApiKey: "" }, dependencies }
  );

  assert.equal(result.runs.length, 1);
  const run = result.runs[0]!;
  await stat(path.join(root, "outputs", "sample", "ТРАНСКРИПТ_sample.md"));
  await stat(path.join(root, "outputs", "sample", "ВИЗУАЛЬНЫЙ_СЦЕНАРИЙ_sample.md"));
  await stat(path.join(root, "outputs", "sample", "YOUTUBE_dQw4w9WgXcQ.json"));
  await stat(path.join(root, ".system", run.run_id, "fingerprint.json"));
  await stat(path.join(root, ".system", run.run_id, "ffprobe.json"));
  await stat(path.join(root, ".system", run.run_id, "audio.wav"));
  await stat(path.join(root, ".system", run.run_id, "transcript.raw.json"));
  await stat(path.join(root, ".system", run.run_id, "qwen.request.json"));
  await stat(path.join(root, ".system", run.run_id, "qwen.response.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.video.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.channel.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.latest-uploads.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.comments.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.captions.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.analytics-summary.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.analytics-daily.json"));
  await stat(path.join(root, ".system", run.run_id, "youtube.analytics-retention.json"));

  const runJson = await readFile(path.join(root, "outputs", "sample", `RUN_${run.run_id}.json`), "utf8");
  assert.match(runJson, /"run_id": "run_20260516T010203000Z_abcdef"/);
  assert.match(runJson, /youtube_retention_json/);
});
