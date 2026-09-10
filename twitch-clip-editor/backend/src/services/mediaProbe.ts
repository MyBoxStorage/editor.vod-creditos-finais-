import { spawn } from "child_process";

export function probeMediaDurationSeconds(
  filePath: string
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", () => {});
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = parseFloat(out.trim().split(/\s+/)[0] ?? "");
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

export function probeImageDimensions(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<{ width?: number; height?: number }>;
        };
        const stream = parsed.streams?.[0];
        const width = stream?.width;
        const height = stream?.height;
        if (
          typeof width === "number" &&
          typeof height === "number" &&
          width > 0 &&
          height > 0
        ) {
          resolve({ width, height });
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}
