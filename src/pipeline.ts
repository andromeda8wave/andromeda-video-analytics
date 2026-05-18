import { randomBytes } from "node:crypto";
import path from "node:path";

import { loadConfig } from "./config.ts";
import {
  computeFileFingerprint,
  ensureDirectory,
  relativeToRoot,
  safeFileStem,
  writeJsonFile,
  writeTextFile
} from "./fs.ts";
import { renderTranscriptMarkdown, renderVisualScenarioMarkdown } from "./markdown.ts";
import { analyzeVideoWithQwen } from "./qwen-video.ts";
import { transcribeAudio } from "./transcription.ts";
import { extractAudio, probeVideo } from "./video.ts";
import { extractYouTubeId, fetchYouTubeAnalytics, fetchYouTubeBundle, fetchYouTubeData } from "./youtube.ts";
import { OUTPUTS_DIR, SYSTEM_DIR } from "./types.ts";
import type {
  NormalizedVideoInput,
  PipelineDependencies,
  PipelineResult,
  PipelineRunManifest,
  PipelineRunResult,
  VideoAnalyticsConfig,
  VideoInputRecord,
  YouTubeCombinedResult
} from "./types.ts";

export async function analyzeVideos(
  records: VideoInputRecord[],
  options: {
    root?: string;
    config?: Partial<VideoAnalyticsConfig>;
    dependencies?: Partial<PipelineDependencies>;
  } = {}
): Promise<PipelineResult> {
  const root = path.resolve(options.root ?? process.cwd());
  const config = loadConfig(root, options.config ?? {});
  const dependencies = buildDependencies(options.dependencies ?? {});
  const runs: PipelineRunResult[] = [];

  for (const record of records) {
    runs.push(await analyzeOneVideo(record, root, config, dependencies));
  }

  return { runs };
}

function buildDependencies(overrides: Partial<PipelineDependencies>): PipelineDependencies {
  return {
    now: () => new Date(),
    randomId: () => randomBytes(3).toString("hex"),
    probeVideo,
    extractAudio,
    transcribe: transcribeAudio,
    analyzeVisuals: analyzeVideoWithQwen,
    fetchYouTubeData,
    fetchYouTubeAnalytics,
    fetchYouTubeBundle,
    ...overrides
  };
}

async function analyzeOneVideo(
  record: VideoInputRecord,
  root: string,
  config: VideoAnalyticsConfig,
  dependencies: PipelineDependencies
): Promise<PipelineRunResult> {
  const input = normalizeInput(record, root, config);
  const stem = safeFileStem(path.basename(input.video_path));
  const runId = makeRunId(dependencies.now(), dependencies.randomId());
  const outputDir = path.join(root, OUTPUTS_DIR, stem);
  const systemDir = path.join(root, SYSTEM_DIR, runId);
  const audioPath = path.join(systemDir, "audio.wav");

  await ensureDirectory(outputDir);
  await ensureDirectory(systemDir);

  const fingerprint = await computeFileFingerprint(input.video_path);
  await writeJsonFile(path.join(systemDir, "fingerprint.json"), fingerprint);

  const ffprobe = await dependencies.probeVideo(input.video_path, config);
  await writeJsonFile(path.join(systemDir, "ffprobe.json"), ffprobe);

  await dependencies.extractAudio(input.video_path, audioPath, config);
  const transcript = await dependencies.transcribe({
    audioPath,
    videoPath: input.video_path,
    input,
    ffprobe,
    config,
    runId
  });
  await writeJsonFile(path.join(systemDir, "transcript.raw.json"), transcript);
  await writeTextFile(
    path.join(outputDir, `ТРАНСКРИПТ_${stem}.md`),
    renderTranscriptMarkdown({
      title: input.title,
      videoPath: input.video_path,
      youtubeId: input.youtube_id ?? null,
      runId,
      transcript
    })
  );

  const visual = await dependencies.analyzeVisuals({
    videoPath: input.video_path,
    systemDir,
    input,
    ffprobe,
    fingerprint,
    config
  });
  await writeJsonFile(path.join(systemDir, "qwen.request.json"), visual.request);
  await writeJsonFile(path.join(systemDir, "qwen.response.json"), visual.response);

  const youtube = await dependencies.fetchYouTubeBundle({
    root,
    youtubeId: input.youtube_id ?? null,
    apiKey: config.youtubeApiKey,
    startDate: "2005-01-01",
    endDate: toDateString(dependencies.now()),
    oauthClientId: config.googleOAuthClientId,
    oauthClientSecret: config.googleOAuthClientSecret,
    tokenPath: config.youtubeOAuthTokenPath
  });
  await writeJsonFile(path.join(systemDir, "youtube.video.json"), youtube.video.data);
  await writeJsonFile(path.join(systemDir, "youtube.channel.json"), youtube.channel.data);
  await writeJsonFile(path.join(systemDir, "youtube.latest-uploads.json"), youtube.latest_uploads.data);
  await writeJsonFile(path.join(systemDir, "youtube.comments.json"), youtube.comments.data);
  await writeJsonFile(path.join(systemDir, "youtube.captions.json"), youtube.captions.data);
  await writeJsonFile(path.join(systemDir, "youtube.analytics-summary.json"), youtube.analytics.summary.data);
  await writeJsonFile(path.join(systemDir, "youtube.analytics-daily.json"), youtube.analytics.daily.data);
  await writeJsonFile(path.join(systemDir, "youtube.analytics-retention.json"), youtube.analytics.retention.data);
  await writeJsonFile(path.join(systemDir, "youtube.data-api.json"), youtube.data_api);
  await writeJsonFile(path.join(systemDir, "youtube.analytics-api.json"), youtube.analytics_api);

  const youtubeOutputName = input.youtube_id ? `YOUTUBE_${input.youtube_id}.json` : "YOUTUBE_no-youtube-id.json";
  await writeJsonFile(path.join(outputDir, youtubeOutputName), youtube);

  await writeTextFile(
    path.join(outputDir, `ВИЗУАЛЬНЫЙ_СЦЕНАРИЙ_${stem}.md`),
    renderVisualScenarioMarkdown({
      title: input.title,
      videoPath: input.video_path,
      youtubeId: input.youtube_id ?? null,
      runId,
      visual,
      youtube
    })
  );

  const manifest: PipelineRunManifest = {
    schema_version: "1.0.0",
    run_id: runId,
    generated_at: dependencies.now().toISOString(),
    input,
    fingerprint,
    ffprobe,
    statuses: {
      transcript: "completed",
      visual_analysis: visual.status,
      youtube_data_api: youtube.data_api_status,
      youtube_analytics_api: youtube.analytics_api_status
    },
    artifacts: {
      output_dir: relativeToRoot(root, outputDir),
      system_dir: relativeToRoot(root, systemDir),
      transcript_markdown: relativeToRoot(root, path.join(outputDir, `ТРАНСКРИПТ_${stem}.md`)),
      visual_markdown: relativeToRoot(root, path.join(outputDir, `ВИЗУАЛЬНЫЙ_СЦЕНАРИЙ_${stem}.md`)),
      youtube_json: relativeToRoot(root, path.join(outputDir, youtubeOutputName)),
      run_json: relativeToRoot(root, path.join(outputDir, `RUN_${runId}.json`)),
      fingerprint_json: relativeToRoot(root, path.join(systemDir, "fingerprint.json")),
      ffprobe_json: relativeToRoot(root, path.join(systemDir, "ffprobe.json")),
      audio_wav: relativeToRoot(root, audioPath),
      transcript_raw_json: relativeToRoot(root, path.join(systemDir, "transcript.raw.json")),
      qwen_request_json: relativeToRoot(root, path.join(systemDir, "qwen.request.json")),
      qwen_response_json: relativeToRoot(root, path.join(systemDir, "qwen.response.json")),
      youtube_data_api_json: relativeToRoot(root, path.join(systemDir, "youtube.data-api.json")),
      youtube_analytics_api_json: relativeToRoot(root, path.join(systemDir, "youtube.analytics-api.json")),
      youtube_video_json: relativeToRoot(root, path.join(systemDir, "youtube.video.json")),
      youtube_channel_json: relativeToRoot(root, path.join(systemDir, "youtube.channel.json")),
      youtube_latest_uploads_json: relativeToRoot(root, path.join(systemDir, "youtube.latest-uploads.json")),
      youtube_comments_json: relativeToRoot(root, path.join(systemDir, "youtube.comments.json")),
      youtube_captions_json: relativeToRoot(root, path.join(systemDir, "youtube.captions.json")),
      youtube_analytics_summary_json: relativeToRoot(root, path.join(systemDir, "youtube.analytics-summary.json")),
      youtube_analytics_daily_json: relativeToRoot(root, path.join(systemDir, "youtube.analytics-daily.json")),
      youtube_retention_json: relativeToRoot(root, path.join(systemDir, "youtube.analytics-retention.json"))
    }
  };
  await writeJsonFile(path.join(outputDir, `RUN_${runId}.json`), manifest);

  return {
    ...manifest,
    output_dir: outputDir,
    system_dir: systemDir
  };
}

export function normalizeInput(
  record: VideoInputRecord,
  root: string,
  config: VideoAnalyticsConfig
): NormalizedVideoInput {
  const videoPath = path.resolve(root, record.video_path);
  const youtubeId = record.youtube_id ?? extractYouTubeId(record.youtube_url);
  const title = record.title?.trim() || path.basename(videoPath, path.extname(videoPath));
  return {
    ...record,
    video_path: videoPath,
    youtube_id: youtubeId ?? undefined,
    title,
    language: record.language ?? config.language
  };
}

export function makeRunId(now: Date, randomId: string): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(".", "");
  return `run_${timestamp}_${randomId}`;
}

function extractPublicationDate(data: unknown): string | null {
  const publishedAt = (data as { items?: Array<{ snippet?: { publishedAt?: string } }> })?.items?.[0]?.snippet
    ?.publishedAt;
  return publishedAt ? publishedAt.slice(0, 10) : null;
}

function toDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}
