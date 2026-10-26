import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  readAccessibilityTree,
  renderAccessibilityDocument,
} from "./accessibility.ts";
import {
  applyEdit,
  captureCommand,
  DEFAULT_SHORTCUT,
  findConflicts,
  formatShortcut,
  installedShortcut,
  parseShortcut,
  planEdit,
  proposalId,
  resolveHyprlandConfig,
  type BindChange,
} from "./bind.ts";
import { rpcContract } from "./contract.ts";
import {
  attachmentName,
  CaptureError,
  captureFileStem,
  captureWindowImage,
  readActiveWindow,
  resolveSessionEnv,
  windowLabel,
} from "./hyprland.ts";
import { CAPTURE_CHANNEL, type CaptureAttachment, type CaptureSignal } from "./signal.ts";

const ACK_TIMEOUT_MS = 2_000;
const CAPTURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CaptureOutcome =
  | { status: "attached"; label: string; imagePath: string; treePath: string | null }
  | { status: "unclaimed"; label: string; imagePath: string; treePath: string | null }
  | { status: "busy" }
  | { status: "failed"; message: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notify(urgency: "low" | "normal", summary: string, body: string): void {
  execFile(
    "notify-send",
    ["-a", "bb", "-u", urgency, "-t", urgency === "low" ? "2500" : "6000", summary, body],
    () => undefined,
  );
}

async function copyImageToClipboard(path: string, env: NodeJS.ProcessEnv): Promise<void> {
  const file = await open(path, "r");
  try {
    await new Promise<void>((resolve) => {
      const child = spawn("wl-copy", ["--type", "image/png"], {
        env,
        stdio: [file.fd, "ignore", "ignore"],
      });
      child.once("error", () => resolve());
      child.once("exit", () => resolve());
    });
  } finally {
    await file.close();
  }
}

function describeOutcome(outcome: CaptureOutcome): string {
  switch (outcome.status) {
    case "attached":
      return `Attached ${outcome.label} to the bb draft.`;
    case "unclaimed":
      return `Saved ${outcome.label} to ${outcome.imagePath}, but no bb desktop window took it.`;
    case "busy":
      return "A capture is already running.";
    case "failed":
      return outcome.message;
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    accessibilityTree: {
      type: "boolean",
      label: "Attach the accessibility tree",
      description:
        "Also attach the window's controls and text as a Markdown file, read through AT-SPI.",
      default: true,
    },
  });

  const pendingAcks = new Map<string, () => void>();
  let capturing = false;
  let primaryHostId: Promise<string | null> | null = null;

  const capturesDir = () =>
    join(bb.server.experimental_dataDir, "plugins", bb.pluginId, "captures");

  const routeUrl = () =>
    `${bb.server.loopbackBaseUrl}/api/v1/plugins/${encodeURIComponent(bb.pluginId)}/http/capture`;

  const marker = () =>
    `${bb.pluginId}@${new URL(bb.server.loopbackBaseUrl).port || "80"}`;

  const hostId = () => {
    primaryHostId ??= bb.sdk.system
      .config()
      .then((config) => config.primaryHostId)
      .catch(() => {
        primaryHostId = null;
        return null;
      });
    return primaryHostId;
  };

  const waitForAck = (id: string) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(id);
        resolve(false);
      }, ACK_TIMEOUT_MS);
      pendingAcks.set(id, () => {
        clearTimeout(timer);
        pendingAcks.delete(id);
        resolve(true);
      });
    });

  async function capture(): Promise<CaptureOutcome> {
    if (capturing) return { status: "busy" };
    capturing = true;
    try {
      const env = await resolveSessionEnv(process.env);
      const window = await readActiveWindow(env);
      const now = new Date();
      const directory = capturesDir();
      await mkdir(directory, { recursive: true });
      const stem = captureFileStem(window, now);
      const imagePath = join(directory, `${stem}.png`);
      const { accessibilityTree } = await settings.get();
      const [, tree] = await Promise.all([
        captureWindowImage(window, imagePath, env),
        accessibilityTree ? readAccessibilityTree(window, { env }) : null,
      ]);
      const label = windowLabel(window);
      const owner = await hostId();
      const image: CaptureAttachment = {
        path: imagePath,
        name: attachmentName(label, "png"),
        mimeType: "image/png",
        sizeBytes: (await stat(imagePath)).size,
        hostId: owner,
      };
      let treeAttachment: CaptureAttachment | null = null;
      if (tree !== null) {
        const treePath = join(directory, `${stem}.accessibility.md`);
        const document = renderAccessibilityDocument(label, window, tree, now);
        await writeFile(treePath, document, "utf8");
        treeAttachment = {
          path: treePath,
          name: attachmentName(`${label} (accessibility tree)`, "md"),
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(document),
          hostId: owner,
        };
      }
      const id = randomUUID();
      const acknowledged = waitForAck(id);
      const signal: CaptureSignal = { id, label, image, tree: treeAttachment };
      bb.realtime.publish(CAPTURE_CHANNEL, signal);
      const claimed = await acknowledged;
      const result = {
        label,
        imagePath,
        treePath: treeAttachment?.path ?? null,
      };
      if (claimed) {
        notify("low", "Window captured", `Attached ${label} to the bb draft.`);
        return { status: "attached", ...result };
      }
      await copyImageToClipboard(imagePath, env).catch(() => undefined);
      notify(
        "normal",
        "Window captured, but no bb window took it",
        "Open bb and try again, or paste the image: it's on the clipboard.",
      );
      return { status: "unclaimed", ...result };
    } catch (error) {
      const text =
        error instanceof CaptureError ? error.message : `Capture failed: ${message(error)}`;
      if (!(error instanceof CaptureError)) {
        bb.log.warn(`window capture failed: ${message(error)}`);
      }
      notify("normal", "Couldn't capture the window", text);
      return { status: "failed", message: text };
    } finally {
      capturing = false;
    }
  }

  async function pruneCaptures(): Promise<void> {
    const directory = capturesDir();
    const cutoff = Date.now() - CAPTURE_RETENTION_MS;
    for (const name of await readdir(directory).catch(() => [])) {
      const path = join(directory, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff) await rm(path, { force: true });
    }
  }

  async function bindContext() {
    const env = await resolveSessionEnv(process.env);
    const location = await resolveHyprlandConfig(process.env, homedir());
    if (location === null) {
      throw new CaptureError(
        "No Hyprland config found. Looked for hyprland.lua and hyprland.conf in ~/.config/hypr.",
      );
    }
    return { env, location, marker: marker(), command: captureCommand(routeUrl()) };
  }

  function toChange(
    input: { action: "install"; shortcut: string } | { action: "remove" },
    command: string,
  ): BindChange {
    if (input.action === "remove") return { action: "remove" };
    const parsed = parseShortcut(input.shortcut);
    if (!parsed.ok) throw new CaptureError(parsed.problem);
    return { action: "install", shortcut: parsed.shortcut, command };
  }

  bb.rpc.register(rpcContract, {
    async status() {
      try {
        const { location, marker: blockMarker, command } = await bindContext();
        const content = await readFile(location.path, "utf8");
        const installed = installedShortcut(content, location.format, blockMarker);
        return {
          problem: null,
          configPath: location.path,
          installed:
            installed === null
              ? null
              : { shortcut: installed.shortcut, current: installed.command === command },
          defaultShortcut: DEFAULT_SHORTCUT,
        };
      } catch (error) {
        return {
          problem: message(error),
          configPath: null,
          installed: null,
          defaultShortcut: DEFAULT_SHORTCUT,
        };
      }
    },
    async preview(input) {
      const { env, location, marker: blockMarker, command } = await bindContext();
      const change = toChange(input, command);
      const before = await readFile(location.path, "utf8");
      const plan = planEdit(before, location.format, blockMarker, change);
      const conflicts =
        change.action === "install"
          ? await findConflicts(change.shortcut, command, env)
          : [];
      return {
        configPath: location.path,
        removed: plan.removed,
        added: plan.added,
        conflicts,
        proposalId: proposalId(location.path, before, plan.after),
      };
    },
    async apply(input) {
      const { env, location, marker: blockMarker, command } = await bindContext();
      const change = toChange(input, command);
      const { backupPath } = await applyEdit(
        location,
        blockMarker,
        change,
        input.proposalId,
        env,
      );
      bb.log.info(
        `${change.action === "install" ? `installed ${formatShortcut(change.shortcut)}` : "removed the capture shortcut"} in ${location.path}; backup at ${backupPath}`,
      );
      return { configPath: location.path, backupPath };
    },
    ack({ id }) {
      const resolve = pendingAcks.get(id);
      resolve?.();
      return { ok: resolve !== undefined };
    },
  });

  bb.http.route("POST", "/capture", async () => Response.json(await capture()));

  bb.cli.register({
    name: "capture-window",
    summary: "Capture the focused Hyprland window into the bb draft on screen",
    commands: [
      {
        name: "capture-window",
        summary: "Capture the focused window and attach it to the current draft",
        usage: "bb capture-window",
      },
    ],
    async run() {
      const outcome = await capture();
      const text = describeOutcome(outcome);
      return outcome.status === "attached" || outcome.status === "unclaimed"
        ? { exitCode: outcome.status === "attached" ? 0 : 2, stdout: `${text}\n` }
        : { exitCode: 1, stderr: `${text}\n` };
    },
  });

  bb.background.schedule("prune-captures", "17 4 * * *", pruneCaptures);
}
