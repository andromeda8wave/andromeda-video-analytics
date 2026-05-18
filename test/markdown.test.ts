import assert from "node:assert/strict";
import test from "node:test";

import { renderTranscriptMarkdown, renderVisualScenarioMarkdown } from "../src/markdown.ts";
import type { RawTranscriptArtifact, VisualAnalysisResult, YouTubeCombinedResult } from "../src/types.ts";

test("renderTranscriptMarkdown includes metadata and timestamped segments", () => {
  const transcript: RawTranscriptArtifact = {
    schema_version: "1.0.0",
    source_id: "source-1",
    original_filename: "sample.mp4",
    language: "ru",
    model_id: "whisper.cpp:large-v3",
    generated_at: "2026-05-16T00:00:00.000Z",
    segments: [
      { start_ms: 0, end_ms: 1234, text: "Вступление." },
      { start_ms: 61234, end_ms: 65000, text: "Главная мысль." }
    ],
    provenance: {
      audio_path: ".system/run/audio.wav",
      generated_by: "video-analytics",
      normalization: { runtime: "ffmpeg", binary: "ffmpeg", args: [] },
      asr: { runtime: "whisper.cpp", binary: "whisper-cli", model: "large-v3", args: [] }
    }
  };

  const markdown = renderTranscriptMarkdown({
    title: "Планирование дня",
    videoPath: "/tmp/sample.mp4",
    youtubeId: "dQw4w9WgXcQ",
    runId: "run_1",
    transcript
  });

  assert.match(markdown, /^# ТРАНСКРИПТ: Планирование дня/m);
  assert.match(markdown, /- YouTube ID: `dQw4w9WgXcQ`/);
  assert.match(markdown, /\*\*00:00:00\.000 - 00:00:01\.234\*\* Вступление\./);
  assert.match(markdown, /\*\*00:01:01\.234 - 00:01:05\.000\*\* Главная мысль\./);
});

test("renderVisualScenarioMarkdown combines YouTube summary and Qwen output", () => {
  const visual: VisualAnalysisResult = {
    status: "completed",
    model: "qwen/qwen3.6-flash",
    prompt: "Опиши визуальный ряд",
    content: "00:00-00:05: крупный план экрана.\nРекомендация: добавить контраст.",
    request: { model: "qwen/qwen3.6-flash" },
    response: { choices: [{ message: { content: "ok" } }] }
  };
  const youtube: YouTubeCombinedResult = {
    youtube_id: "dQw4w9WgXcQ",
    data_api_status: "completed",
    analytics_api_status: "skipped_missing_oauth",
    data_api: {
      items: [
        {
          snippet: { title: "Видео", channelTitle: "Канал", publishedAt: "2026-05-01T00:00:00Z" },
          statistics: { viewCount: "123", likeCount: "7", commentCount: "2" }
        }
      ]
    },
    analytics_api: { analytics_api_status: "skipped_missing_oauth" }
  };

  const markdown = renderVisualScenarioMarkdown({
    title: "Видео",
    videoPath: "/tmp/sample.mp4",
    youtubeId: "dQw4w9WgXcQ",
    runId: "run_1",
    visual,
    youtube
  });

  assert.match(markdown, /^# ВИЗУАЛЬНЫЙ СЦЕНАРИЙ: Видео/m);
  assert.match(markdown, /Просмотры: `123`/);
  assert.match(markdown, /00:00-00:05: крупный план экрана\./);
  assert.match(markdown, /Analytics: `skipped_missing_oauth`/);
});
