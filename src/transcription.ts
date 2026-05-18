import { promises as fs } from "node:fs";
import path from "node:path";

import { resolveBinaryPath, runExternalCommand } from "./runtime.ts";
import { GENERATED_BY } from "./types.ts";
import type { RawTranscriptArtifact, TranscriptionArgs, TranscriptSegment } from "./types.ts";

export async function transcribeAudio(args: TranscriptionArgs): Promise<RawTranscriptArtifact> {
  if (args.config.transcriber === "openrouter-stt") {
    return transcribeWithOpenRouter(args);
  }
  return transcribeWithLocalWhisper(args);
}

export async function transcribeWithLocalWhisper(args: TranscriptionArgs): Promise<RawTranscriptArtifact> {
  const whisper = await resolveBinaryPath(args.config.whisperBin, ["whisper-cli"]);
  const modelPath = path.resolve(args.config.whisperModel);
  await fs.access(modelPath);

  const whisperArgs = [
    "--model",
    modelPath,
    "--file",
    args.audioPath,
    "--language",
    args.input.language
  ];
  const { stdout } = await runExternalCommand(whisper, whisperArgs, { cwd: args.config.root });
  const segments = parseWhisperStdout(stdout);

  return {
    schema_version: "1.0.0",
    source_id: args.runId,
    original_filename: path.basename(args.videoPath),
    language: args.input.language,
    model_id: `whisper.cpp:${path.basename(modelPath)}`,
    generated_at: new Date().toISOString(),
    segments,
    provenance: {
      audio_path: args.audioPath,
      generated_by: GENERATED_BY,
      normalization: {
        runtime: "ffmpeg",
        binary: args.config.ffmpegBin,
        args: ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
      },
      asr: {
        runtime: "whisper.cpp",
        binary: whisper,
        model: modelPath,
        args: whisperArgs
      }
    }
  };
}

export async function transcribeWithOpenRouter(args: TranscriptionArgs): Promise<RawTranscriptArtifact> {
  if (!args.config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for VIDEO_ANALYTICS_TRANSCRIBER=openrouter-stt.");
  }
  const audioBytes = await fs.readFile(args.audioPath);
  const request = {
    input_audio: {
      data: audioBytes.toString("base64"),
      format: "wav"
    },
    model: args.config.openRouterSttModel,
    language: args.input.language
  };
  const response = await fetch(`${args.config.openRouterBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.config.openRouterApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });
  const body = (await response.json()) as { text?: string; [key: string]: unknown };
  if (!response.ok) {
    throw new Error(`OpenRouter STT failed (${response.status}): ${JSON.stringify(body)}`);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const segments = text
    ? [{ start_ms: 0, end_ms: args.ffprobe.duration_ms, text, confidence: 0.9 }]
    : [];

  return {
    schema_version: "1.0.0",
    source_id: args.runId,
    original_filename: path.basename(args.videoPath),
    language: args.input.language,
    model_id: args.config.openRouterSttModel,
    generated_at: new Date().toISOString(),
    segments,
    provenance: {
      audio_path: args.audioPath,
      generated_by: GENERATED_BY,
      normalization: {
        runtime: "ffmpeg",
        binary: args.config.ffmpegBin,
        args: ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
      },
      asr: {
        runtime: "openrouter-stt",
        binary: "openrouter",
        model: args.config.openRouterSttModel,
        args: []
      }
    }
  };
}

export function parseWhisperStdout(stdout: string): TranscriptSegment[] {
  const timestampPattern =
    /^\s*\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.+?)\s*$/;
  const segments: TranscriptSegment[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(timestampPattern);
    if (!match) {
      continue;
    }
    const text = match[9]?.trim();
    if (!text) {
      continue;
    }
    segments.push({
      start_ms: toMilliseconds(match[1]!, match[2]!, match[3]!, match[4]!),
      end_ms: toMilliseconds(match[5]!, match[6]!, match[7]!, match[8]!),
      text,
      confidence: deriveSegmentConfidence(text)
    });
  }

  return segments;
}

function toMilliseconds(hours: string, minutes: string, seconds: string, milliseconds: string): number {
  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function deriveSegmentConfidence(text: string): number {
  if (/\[inaudible\]/i.test(text)) {
    return 0.3;
  }
  if (text.includes("...") || text.includes("…")) {
    return 0.55;
  }
  if (text.trim().split(/\s+/).length < 4) {
    return 0.7;
  }
  return 0.92;
}
