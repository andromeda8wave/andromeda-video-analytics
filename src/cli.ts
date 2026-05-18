#!/usr/bin/env node
import path from "node:path";

import { loadConfig, loadDotEnv } from "./config.ts";
import { readJsonlFile } from "./fs.ts";
import { analyzeVideos } from "./pipeline.ts";
import { runYouTubeAuth } from "./youtube.ts";
import type { VideoAnalyticsConfig, VideoInputRecord } from "./types.ts";

interface ParsedCli {
  command: "analyze" | "youtube:auth" | "help";
  input?: string;
  video?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  title?: string;
  transcriber?: string;
  root?: string;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    printHelp();
    return;
  }

  const root = path.resolve(parsed.root ?? process.cwd());
  await loadDotEnv(root);
  const configOverrides: Partial<VideoAnalyticsConfig> = {};
  if (parsed.transcriber) {
    configOverrides.transcriber = parsed.transcriber as VideoAnalyticsConfig["transcriber"];
  }
  const config = loadConfig(root, configOverrides);

  if (parsed.command === "youtube:auth") {
    await runYouTubeAuth(config);
    return;
  }

  const records = await recordsFromCli(parsed, root);
  const result = await analyzeVideos(records, { root, config });
  for (const run of result.runs) {
    console.log(`Analyzed ${run.input.video_path}`);
    console.log(`  output: ${run.output_dir}`);
    console.log(`  system: ${run.system_dir}`);
    console.log(`  run_id: ${run.run_id}`);
  }
}

export function parseArgs(argv: string[]): ParsedCli {
  const args = [...argv];
  let command: ParsedCli["command"] = "analyze";
  if (args[0] === "analyze" || args[0] === "youtube:auth") {
    command = args.shift() as ParsedCli["command"];
  }
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help" };
  }

  const parsed: ParsedCli = { command };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    index += 1;
    if (key === "--input") {
      parsed.input = value;
    } else if (key === "--video") {
      parsed.video = value;
    } else if (key === "--youtube-url") {
      parsed.youtubeUrl = value;
    } else if (key === "--youtube-id") {
      parsed.youtubeId = value;
    } else if (key === "--title") {
      parsed.title = value;
    } else if (key === "--transcriber") {
      parsed.transcriber = value;
    } else if (key === "--root") {
      parsed.root = value;
    } else {
      throw new Error(`Unknown option: ${key}`);
    }
  }

  return parsed;
}

async function recordsFromCli(parsed: ParsedCli, root: string): Promise<VideoInputRecord[]> {
  if (parsed.input) {
    return readJsonlFile<VideoInputRecord>(path.resolve(root, parsed.input));
  }
  if (!parsed.video) {
    throw new Error("Pass --video for a single run or --input for a JSONL manifest.");
  }
  return [
    {
      video_path: parsed.video,
      youtube_url: parsed.youtubeUrl,
      youtube_id: parsed.youtubeId,
      title: parsed.title
    }
  ];
}

function printHelp(): void {
  console.log(`Video Analytics MVP

Usage:
  npm run analyze -- --video "/path/to/video.mp4" --youtube-url "https://youtu.be/VIDEO_ID"
  npm run analyze -- --input inputs/videos.jsonl
  npm run youtube:auth

Options:
  --video PATH
  --youtube-url URL
  --youtube-id ID
  --title TITLE
  --input PATH
  --transcriber local-whisper|openrouter-stt
  --root PATH
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
