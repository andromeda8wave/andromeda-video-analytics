import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { FileFingerprint, JsonValue } from "./types.ts";

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readTextFile(targetPath: string): Promise<string> {
  return fs.readFile(targetPath, "utf8");
}

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  return JSON.parse(await readTextFile(targetPath)) as T;
}

export async function readJsonlFile<T>(targetPath: string): Promise<T[]> {
  const contents = await readTextFile(targetPath);
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeTextFile(targetPath: string, contents: string): Promise<void> {
  await writeUtf8FileAtomically(targetPath, ensureTrailingNewline(contents.trimEnd()));
}

export async function writeJsonFile(targetPath: string, data: unknown): Promise<void> {
  await writeUtf8FileAtomically(targetPath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function writeJsonlFile(targetPath: string, items: JsonValue[]): Promise<void> {
  await writeUtf8FileAtomically(
    targetPath,
    ensureTrailingNewline(items.map((item) => JSON.stringify(item)).join("\n"))
  );
}

export async function computeFileFingerprint(targetPath: string): Promise<FileFingerprint> {
  const stats = await fs.stat(targetPath);
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(targetPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return {
    content_sha256: hash.digest("hex"),
    byte_size: stats.size,
    mtime_ms: stats.mtimeMs
  };
}

export function safeFileStem(value: string): string {
  const trimmed = value.trim();
  const extension = path.extname(trimmed);
  const withoutExtension = extension && extension !== "." ? trimmed.slice(0, -extension.length) : trimmed;
  const safe = withoutExtension
    .normalize("NFKC")
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "video";
}

export function relativeToRoot(root: string, targetPath: string): string {
  return path.relative(root, targetPath).split(path.sep).join("/");
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function writeUtf8FileAtomically(targetPath: string, contents: string): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, contents, "utf8");
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}
