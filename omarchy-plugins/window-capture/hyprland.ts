import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const activeWindowSchema = z.object({
  address: z.string().regex(/^0x[0-9a-f]+$/i),
  pid: z.number().int().positive(),
  class: z.string(),
  title: z.string(),
  at: z.tuple([z.number().int(), z.number().int()]),
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});

export type ActiveWindow = z.infer<typeof activeWindowSchema>;

const screenSharePropSchema = z.object({ no_screen_share: z.boolean() });

export class CaptureError extends Error {}

export interface ToolResult {
  stdout: string;
}

export type RunTool = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<ToolResult>;

export const runTool: RunTool = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { env, timeout: 5_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const code = "code" in error ? error.code : undefined;
          reject(
            new CaptureError(
              code === "ENOENT"
                ? `${file} isn't installed.`
                : stderr.trim() || error.message,
            ),
          );
          return;
        }
        resolve({ stdout });
      },
    );
  });

export interface SessionProbe {
  isSocket(path: string): Promise<boolean>;
  list(directory: string): Promise<string[]>;
  modifiedAt(path: string): Promise<number>;
}

export const fileSessionProbe: SessionProbe = {
  async isSocket(path) {
    const info = await stat(path).catch(() => null);
    return info?.isSocket() ?? false;
  },
  list: (directory) => readdir(directory).catch(() => []),
  async modifiedAt(path) {
    const info = await stat(path).catch(() => null);
    return info?.mtimeMs ?? 0;
  },
};

async function newest(
  probe: SessionProbe,
  candidates: readonly { name: string; socket: string }[],
): Promise<string | null> {
  let best: { name: string; time: number } | null = null;
  for (const candidate of candidates) {
    if (!(await probe.isSocket(candidate.socket))) continue;
    const time = await probe.modifiedAt(candidate.socket);
    if (best === null || time > best.time) {
      best = { name: candidate.name, time };
    }
  }
  return best?.name ?? null;
}

export async function resolveSessionEnv(
  env: NodeJS.ProcessEnv,
  probe: SessionProbe = fileSessionProbe,
  uid: number = process.getuid?.() ?? 1000,
): Promise<NodeJS.ProcessEnv> {
  const runtimeDir = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const hyprDir = join(runtimeDir, "hypr");
  const signature = env.HYPRLAND_INSTANCE_SIGNATURE;
  const signatureLive =
    signature !== undefined &&
    /^[A-Za-z0-9_]+$/.test(signature) &&
    (await probe.isSocket(join(hyprDir, signature, ".socket.sock")));
  const resolvedSignature = signatureLive
    ? signature
    : await newest(
        probe,
        (await probe.list(hyprDir)).map((name) => ({
          name,
          socket: join(hyprDir, name, ".socket.sock"),
        })),
      );
  if (resolvedSignature === null) {
    throw new CaptureError("Hyprland isn't running in this session.");
  }
  const display = env.WAYLAND_DISPLAY;
  const displayLive =
    display !== undefined &&
    /^wayland-\d+$/.test(display) &&
    (await probe.isSocket(join(runtimeDir, display)));
  const resolvedDisplay = displayLive
    ? display
    : await newest(
        probe,
        (await probe.list(runtimeDir))
          .filter((name) => /^wayland-\d+$/.test(name))
          .map((name) => ({ name, socket: join(runtimeDir, name) })),
      );
  if (resolvedDisplay === null) {
    throw new CaptureError("No Wayland display is running in this session.");
  }
  return {
    ...env,
    XDG_RUNTIME_DIR: runtimeDir,
    HYPRLAND_INSTANCE_SIGNATURE: resolvedSignature,
    WAYLAND_DISPLAY: resolvedDisplay,
  };
}

export function parseActiveWindow(stdout: string): ActiveWindow {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new CaptureError("hyprctl returned something that isn't JSON.");
  }
  const parsed = activeWindowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CaptureError("No window is focused.");
  }
  return parsed.data;
}

export function windowLabel(window: ActiveWindow): string {
  const title = window.title.replace(/^[⠀-⣿]\s*/, "").trim();
  const app = window.class.trim() || "window";
  return title === "" || title === app ? app : `${app} — ${title}`;
}

export function attachmentName(label: string, extension: string): string {
  const cleaned = label
    .replace(/[\u0000-\u001f\u007f/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const limit = 120;
  const short =
    cleaned.length > limit ? `${cleaned.slice(0, limit - 1).trimEnd()}…` : cleaned;
  return `${short || "window"}.${extension}`;
}

export function captureFileStem(window: ActiveWindow, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const app =
    window.class
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "window";
  return `${stamp}-${app}`;
}

export function grimGeometry(window: ActiveWindow): string {
  return `${window.at[0]},${window.at[1]} ${window.size[0]}x${window.size[1]}`;
}

export const MAX_IMAGE_EDGE = 1920;

export function grimScale(window: ActiveWindow): string {
  const longEdge = Math.max(window.size[0], window.size[1]);
  const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
  return String(Math.floor(scale * 1000) / 1000);
}

export async function readActiveWindow(
  env: NodeJS.ProcessEnv,
  run: RunTool = runTool,
): Promise<ActiveWindow> {
  const { stdout } = await run("hyprctl", ["-j", "activewindow"], env);
  return parseActiveWindow(stdout);
}

export async function blocksScreenCapture(
  window: ActiveWindow,
  env: NodeJS.ProcessEnv,
  run: RunTool = runTool,
): Promise<boolean> {
  const result = await run(
    "hyprctl",
    ["-j", "getprop", `address:${window.address}`, "no_screen_share"],
    env,
  ).catch(() => null);
  if (result === null) return false;
  try {
    const parsed = screenSharePropSchema.safeParse(JSON.parse(result.stdout));
    return parsed.success && parsed.data.no_screen_share;
  } catch {
    return false;
  }
}

export async function captureWindowImage(
  window: ActiveWindow,
  imagePath: string,
  env: NodeJS.ProcessEnv,
  run: RunTool = runTool,
): Promise<void> {
  if (await blocksScreenCapture(window, env, run)) {
    throw new CaptureError(
      "This window blocks screen capture (a no_screen_share rule applies).",
    );
  }
  await run(
    "grim",
    ["-g", grimGeometry(window), "-s", grimScale(window), "-t", "png", imagePath],
    env,
  );
}
