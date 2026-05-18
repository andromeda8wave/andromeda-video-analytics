import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDirectory } from "./fs.ts";
import { resolveBinaryPath, runExternalCommand } from "./runtime.ts";
import type { FfprobeInfo, JsonValue, VideoAnalyticsConfig } from "./types.ts";

export async function probeVideo(videoPath: string, config: VideoAnalyticsConfig): Promise<FfprobeInfo> {
  const ffprobe = await resolveBinaryPath(config.ffprobeBin, ["ffprobe"]);
  const { stdout } = await runExternalCommand(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath
  ]);
  const raw = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const streams = raw.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(raw.format?.duration ?? videoStream?.duration ?? 0);

  return {
    duration_ms: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : 0,
    width: readNullableNumber(videoStream?.width),
    height: readNullableNumber(videoStream?.height),
    video_codec: readNullableString(videoStream?.codec_name),
    audio_codec: readNullableString(audioStream?.codec_name),
    raw: raw as JsonValue
  };
}

export async function extractAudio(
  videoPath: string,
  audioPath: string,
  config: VideoAnalyticsConfig
): Promise<void> {
  await ensureDirectory(path.dirname(audioPath));
  const ffmpeg = await resolveBinaryPath(config.ffmpegBin, ["ffmpeg"]);
  await runExternalCommand(ffmpeg, [
    "-hide_banner",
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath
  ]);
}

export async function prepareVideoDataUrl(
  videoPath: string,
  systemDir: string,
  config: VideoAnalyticsConfig
): Promise<{ dataUrl: string; sourcePath: string; mimeType: string; compressed: boolean }> {
  const stats = await fs.stat(videoPath);
  if (stats.size <= config.maxDirectVideoBytes && supportedVideoMimeType(videoPath)) {
    return {
      dataUrl: await encodeVideoAsDataUrl(videoPath, mimeTypeForVideo(videoPath)),
      sourcePath: videoPath,
      mimeType: mimeTypeForVideo(videoPath),
      compressed: false
    };
  }

  const previewPath = path.join(systemDir, "qwen-preview.mp4");
  await createCompressedPreview(videoPath, previewPath, config);
  return {
    dataUrl: await encodeVideoAsDataUrl(previewPath, "video/mp4"),
    sourcePath: previewPath,
    mimeType: "video/mp4",
    compressed: true
  };
}

export function mimeTypeForVideo(videoPath: string): string {
  const extension = path.extname(videoPath).toLowerCase();
  if (extension === ".mov") {
    return "video/mov";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".mpeg" || extension === ".mpg") {
    return "video/mpeg";
  }
  return "video/mp4";
}

async function createCompressedPreview(
  videoPath: string,
  previewPath: string,
  config: VideoAnalyticsConfig
): Promise<void> {
  await ensureDirectory(path.dirname(previewPath));
  const ffmpeg = await resolveBinaryPath(config.ffmpegBin, ["ffmpeg"]);
  await runExternalCommand(ffmpeg, [
    "-hide_banner",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `scale=-2:${config.previewMaxHeight},fps=6`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-movflags",
    "+faststart",
    previewPath
  ]);
}

async function encodeVideoAsDataUrl(videoPath: string, mimeType: string): Promise<string> {
  const bytes = await fs.readFile(videoPath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function supportedVideoMimeType(videoPath: string): boolean {
  return ["video/mp4", "video/mov", "video/mpeg", "video/webm"].includes(mimeTypeForVideo(videoPath));
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
