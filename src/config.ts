import { promises as fs } from "node:fs";
import path from "node:path";

import type { TranscriberKind, VideoAnalyticsConfig } from "./types.ts";

export async function loadDotEnv(root: string): Promise<void> {
  const envPath = path.join(root, ".env");
  let contents = "";
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = unquoteEnvValue(line.slice(separator + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(
  root = process.cwd(),
  overrides: Partial<VideoAnalyticsConfig> = {}
): VideoAnalyticsConfig {
  const resolvedRoot = path.resolve(root);
  const transcriber = readEnv("VIDEO_ANALYTICS_TRANSCRIBER", "local-whisper") as TranscriberKind;

  return normalizeConfigPaths({
    root: resolvedRoot,
    openRouterApiKey: readEnv("OPENROUTER_API_KEY", ""),
    openRouterBaseUrl: readEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    qwenModel: readEnv("VIDEO_ANALYTICS_QWEN_MODEL", "qwen/qwen3.6-flash"),
    transcriber,
    openRouterSttModel: readEnv("VIDEO_ANALYTICS_STT_MODEL", "openai/whisper-large-v3"),
    whisperBin: readEnv("VIDEO_ANALYTICS_WHISPER_BIN", "whisper-cli"),
    whisperModel: readEnv("VIDEO_ANALYTICS_WHISPER_MODEL", "./models/ggml-large-v3.bin"),
    ffmpegBin: readEnv("VIDEO_ANALYTICS_FFMPEG_BIN", "ffmpeg"),
    ffprobeBin: readEnv("VIDEO_ANALYTICS_FFPROBE_BIN", "ffprobe"),
    youtubeApiKey: readEnv("YOUTUBE_API_KEY", ""),
    googleOAuthClientId: readEnv("GOOGLE_OAUTH_CLIENT_ID", ""),
    googleOAuthClientSecret: readEnv("GOOGLE_OAUTH_CLIENT_SECRET", ""),
    youtubeOAuthTokenPath: readEnv(
      "YOUTUBE_OAUTH_TOKEN_PATH",
      path.join(".system", "youtube-oauth-token.json")
    ),
    maxDirectVideoBytes: readNumberEnv("VIDEO_ANALYTICS_MAX_DIRECT_VIDEO_BYTES", 20 * 1024 * 1024),
    previewMaxHeight: readNumberEnv("VIDEO_ANALYTICS_PREVIEW_MAX_HEIGHT", 720),
    language: readEnv("VIDEO_ANALYTICS_LANGUAGE", "ru"),
    ...overrides,
    root: overrides.root ? path.resolve(overrides.root) : resolvedRoot
  });
}

function readEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeConfigPaths(config: VideoAnalyticsConfig): VideoAnalyticsConfig {
  return {
    ...config,
    whisperBin: resolveExecutableConfigPath(config.root, config.whisperBin),
    whisperModel: resolveConfigPath(config.root, config.whisperModel),
    ffmpegBin: resolveExecutableConfigPath(config.root, config.ffmpegBin),
    ffprobeBin: resolveExecutableConfigPath(config.root, config.ffprobeBin),
    youtubeOAuthTokenPath: resolveConfigPath(config.root, config.youtubeOAuthTokenPath)
  };
}

function resolveExecutableConfigPath(root: string, value: string): string {
  return value.includes("/") || value.includes("\\") ? resolveConfigPath(root, value) : value;
}

function resolveConfigPath(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}
