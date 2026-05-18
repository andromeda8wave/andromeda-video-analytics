import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function resolveBinaryPath(binaryOrEnv: string, fallbackNames: string[] = []): Promise<string> {
  const candidates = [binaryOrEnv, ...fallbackNames].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || candidate.startsWith(".")) {
      const resolved = path.resolve(candidate);
      if (await pathExists(resolved)) {
        return resolved;
      }
      continue;
    }

    const found = await findOnPath(candidate);
    if (found) {
      return found;
    }
  }

  throw new Error(`Binary not found: ${candidates.join(", ")}`);
}

export async function runExternalCommand(
  binary: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (error) => {
      reject(new Error(`Command failed: ${binary} ${args.join(" ")}\n${error.message}`.trim()));
    });
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      const details = stderr.trim() || stdout.trim() || suffix;
      reject(new Error(`Command failed: ${binary} ${args.join(" ")}\n${details}`.trim()));
    });
  });
}

async function findOnPath(name: string): Promise<string | null> {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
