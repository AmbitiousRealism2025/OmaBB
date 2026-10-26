import { createHash } from "node:crypto";
import {
  copyFile,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { CaptureError, runTool, type RunTool } from "./hyprland.ts";

export type ConfigFormat = "lua" | "conf";

export const MODIFIERS = ["SUPER", "CTRL", "SHIFT", "ALT"] as const;
export type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  SUPER: "SUPER",
  CTRL: "CTRL",
  CONTROL: "CTRL",
  SHIFT: "SHIFT",
  ALT: "ALT",
};

const MODMASK: Record<Modifier, number> = {
  SHIFT: 1,
  CTRL: 4,
  ALT: 8,
  SUPER: 64,
};

export const DEFAULT_SHORTCUT = "SUPER + CTRL + SHIFT + S";
export const BIND_DESCRIPTION = "Capture window to bb";

export interface Shortcut {
  modifiers: Modifier[];
  key: string;
}

export type ShortcutParse =
  | { ok: true; shortcut: Shortcut }
  | { ok: false; problem: string };

export function parseShortcut(input: string): ShortcutParse {
  const tokens = input
    .split(/[+\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) {
    return { ok: false, problem: "Enter a shortcut such as SUPER + CTRL + SHIFT + S." };
  }
  const modifiers = new Set<Modifier>();
  const keys: string[] = [];
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toUpperCase()];
    if (modifier === undefined) keys.push(token);
    else modifiers.add(modifier);
  }
  if (keys.length !== 1) {
    return { ok: false, problem: "Use exactly one key besides the modifiers." };
  }
  const key = keys[0] ?? "";
  if (!/^[A-Za-z0-9_]+$/.test(key)) {
    return { ok: false, problem: `"${key}" isn't a key name Hyprland accepts.` };
  }
  if (modifiers.size === 0) {
    return { ok: false, problem: "Add at least one modifier so the key still types normally." };
  }
  return {
    ok: true,
    shortcut: {
      modifiers: MODIFIERS.filter((modifier) => modifiers.has(modifier)),
      key: key.toUpperCase(),
    },
  };
}

export function formatShortcut(shortcut: Shortcut): string {
  return [...shortcut.modifiers, shortcut.key].join(" + ");
}

export function shortcutModmask(shortcut: Shortcut): number {
  return shortcut.modifiers.reduce((mask, modifier) => mask | MODMASK[modifier], 0);
}

export function captureCommand(routeUrl: string): string {
  return `curl -fsS -m 10 -X POST -H 'content-type: application/json' -d '{}' ${routeUrl} >/dev/null || notify-send -a bb "Couldn't capture the window" "Is bb running? The shortcut talks to ${routeUrl}"`;
}

function commentPrefix(format: ConfigFormat): string {
  return format === "lua" ? "--" : "#";
}

function beginLine(format: ConfigFormat, marker: string): string {
  return `${commentPrefix(format)} >>> window-capture ${marker} begin`;
}

function endLine(format: ConfigFormat, marker: string): string {
  return `${commentPrefix(format)} <<< window-capture ${marker} end`;
}

function luaLongString(value: string): string {
  let level = "";
  while (value.includes(`]${level}]`)) level += "=";
  return `[${level}[${value}]${level}]`;
}

export function renderBlock(
  format: ConfigFormat,
  marker: string,
  shortcut: Shortcut,
  command: string,
): string[] {
  const body =
    format === "lua"
      ? `hl.bind("${formatShortcut(shortcut)}", hl.dsp.exec_cmd(${luaLongString(command)}), { description = "${BIND_DESCRIPTION}" })`
      : `bindd = ${shortcut.modifiers.join(" ")}, ${shortcut.key}, ${BIND_DESCRIPTION}, exec, ${command}`;
  return [
    `${beginLine(format, marker)} (added by a bb plugin; change or remove it from the plugin's settings)`,
    body,
    endLine(format, marker),
  ];
}

interface BlockLocation {
  start: number;
  end: number;
}

function locateBlock(
  lines: readonly string[],
  format: ConfigFormat,
  marker: string,
): BlockLocation | null {
  const begin = beginLine(format, marker);
  const end = endLine(format, marker);
  const start = lines.findIndex((line) => line.trim().startsWith(begin));
  if (start === -1) return null;
  const stop = lines.findIndex(
    (line, index) => index > start && line.trim() === end,
  );
  if (stop === -1) {
    throw new CaptureError(
      "The window-capture block in your Hyprland config has no end marker. Fix or delete it by hand first.",
    );
  }
  return { start, end: stop };
}

export function installedShortcut(
  content: string,
  format: ConfigFormat,
  marker: string,
): { shortcut: string; command: string } | null {
  const lines = content.split("\n");
  const block = locateBlock(lines, format, marker);
  if (block === null) return null;
  const body = lines.slice(block.start + 1, block.end).join("\n");
  const match =
    format === "lua"
      ? /hl\.bind\("([^"]+)",\s*hl\.dsp\.exec_cmd\(\[(=*)\[([\s\S]*?)\]\2\]\)/.exec(body)
      : /bindd\s*=\s*([^,]*),\s*([^,]+),[^,]*,\s*exec,\s*(.+)/.exec(body);
  if (match === null) return { shortcut: "", command: "" };
  if (format === "lua") {
    return { shortcut: match[1] ?? "", command: match[3] ?? "" };
  }
  const parsed = parseShortcut(`${match[1] ?? ""} ${match[2] ?? ""}`);
  return {
    shortcut: parsed.ok ? formatShortcut(parsed.shortcut) : "",
    command: (match[3] ?? "").trim(),
  };
}

export type BindChange =
  | { action: "install"; shortcut: Shortcut; command: string }
  | { action: "remove" };

export interface PlannedEdit {
  after: string;
  removed: string[];
  added: string[];
}

export function planEdit(
  before: string,
  format: ConfigFormat,
  marker: string,
  change: BindChange,
): PlannedEdit {
  const lines = before.split("\n");
  const block = locateBlock(lines, format, marker);
  const removed = block === null ? [] : lines.slice(block.start, block.end + 1);
  const kept =
    block === null
      ? lines
      : [...lines.slice(0, block.start), ...lines.slice(block.end + 1)];
  if (change.action === "remove") {
    if (block !== null && block.start > 0 && kept[block.start - 1] === "") {
      kept.splice(block.start - 1, 1);
    }
    return { after: kept.join("\n"), removed, added: [] };
  }
  const added = renderBlock(format, marker, change.shortcut, change.command);
  const base = kept.join("\n");
  const trimmed = base.replace(/\n+$/, "");
  const after = `${trimmed}${trimmed === "" ? "" : "\n\n"}${added.join("\n")}\n`;
  return { after, removed, added };
}

export function proposalId(path: string, before: string, after: string): string {
  return createHash("sha256")
    .update(path)
    .update("\0")
    .update(before)
    .update("\0")
    .update(after)
    .digest("hex");
}

export interface ConfigLocation {
  path: string;
  format: ConfigFormat;
}

export type Exists = (path: string) => Promise<boolean>;

export const fileExists: Exists = async (path) =>
  (await stat(path).catch(() => null))?.isFile() ?? false;

export async function resolveHyprlandConfig(
  env: NodeJS.ProcessEnv,
  home: string,
  exists: Exists = fileExists,
): Promise<ConfigLocation | null> {
  const directories = [
    ...(env.XDG_CONFIG_HOME ? [join(env.XDG_CONFIG_HOME, "hypr")] : []),
    join(home, ".config", "hypr"),
  ];
  for (const directory of directories) {
    if (await exists(join(directory, "hyprland.lua"))) {
      const bindings = join(directory, "bindings.lua");
      return {
        path: (await exists(bindings)) ? bindings : join(directory, "hyprland.lua"),
        format: "lua",
      };
    }
    if (await exists(join(directory, "hyprland.conf"))) {
      const bindings = join(directory, "bindings.conf");
      return {
        path: (await exists(bindings)) ? bindings : join(directory, "hyprland.conf"),
        format: "conf",
      };
    }
  }
  return null;
}

const bindsSchema = z.array(
  z.object({
    modmask: z.number().int(),
    key: z.string(),
    arg: z.string(),
    description: z.string().optional(),
    dispatcher: z.string().optional(),
  }),
);

export async function findConflicts(
  shortcut: Shortcut,
  ownCommand: string,
  env: NodeJS.ProcessEnv,
  run: RunTool = runTool,
): Promise<string[]> {
  const result = await run("hyprctl", ["-j", "binds"], env).catch(() => null);
  if (result === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const parsed = bindsSchema.safeParse(raw);
  if (!parsed.success) return [];
  const mask = shortcutModmask(shortcut);
  return parsed.data
    .filter(
      (bind) =>
        bind.modmask === mask &&
        bind.key.toUpperCase() === shortcut.key &&
        bind.arg.trim() !== ownCommand,
    )
    .map((bind) => bind.description || `${bind.dispatcher ?? "bind"} ${bind.arg}`.trim());
}

const configErrorsSchema = z.array(z.string());

async function configErrors(env: NodeJS.ProcessEnv, run: RunTool): Promise<string[]> {
  const result = await run("hyprctl", ["-j", "configerrors"], env).catch(() => null);
  if (result === null) return [];
  try {
    const parsed = configErrorsSchema.safeParse(JSON.parse(result.stdout));
    return parsed.success ? parsed.data.filter((line) => line.trim() !== "") : [];
  } catch {
    return [];
  }
}

export interface ApplyResult {
  backupPath: string;
}

export async function applyEdit(
  location: ConfigLocation,
  marker: string,
  change: BindChange,
  expectedProposal: string,
  env: NodeJS.ProcessEnv,
  run: RunTool = runTool,
  now: () => number = Date.now,
): Promise<ApplyResult> {
  const before = await readFile(location.path, "utf8");
  const { after } = planEdit(before, location.format, marker, change);
  if (proposalId(location.path, before, after) !== expectedProposal) {
    throw new CaptureError(
      "Your Hyprland config changed since you reviewed this edit. Review it again.",
    );
  }
  const target = await realpath(location.path);
  const mode = (await stat(target)).mode & 0o777;
  const backupPath = `${location.path}.bak.window-capture.${now()}`;
  await copyFile(target, backupPath);
  const errorsBefore = new Set(await configErrors(env, run));
  const staged = join(dirname(target), `.${basename(target)}.window-capture-${process.pid}`);
  try {
    await writeFile(staged, after, { mode, flag: "wx" });
    await rename(staged, target);
  } finally {
    await rm(staged, { force: true });
  }
  await run("hyprctl", ["reload"], env).catch(() => null);
  const introduced = (await configErrors(env, run)).filter(
    (line) => !errorsBefore.has(line),
  );
  if (introduced.length > 0) {
    await copyFile(backupPath, target);
    await run("hyprctl", ["reload"], env).catch(() => null);
    throw new CaptureError(
      `Hyprland rejected the change, so the original config is back: ${introduced.join("; ")}`,
    );
  }
  return { backupPath };
}
