import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ActiveWindow } from "./hyprland.ts";

export const HELPER_PATH = fileURLToPath(
  new URL("./atspi_tree.py", import.meta.url),
);

const helperOutputSchema = z.discriminatedUnion("matched", [
  z.object({
    matched: z.literal(true),
    text: z.string(),
    nodes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({ matched: z.literal(false), reason: z.string() }),
]);

export interface AccessibilityTree {
  text: string;
  nodes: number;
  truncated: boolean;
}

export interface AccessibilityOptions {
  python?: string;
  helperPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export function parseHelperOutput(stdout: string): AccessibilityTree | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = helperOutputSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.matched) return null;
  if (parsed.data.nodes <= 1) return null;
  return {
    text: parsed.data.text,
    nodes: parsed.data.nodes,
    truncated: parsed.data.truncated,
  };
}

export function readAccessibilityTree(
  window: ActiveWindow,
  options: AccessibilityOptions = {},
): Promise<AccessibilityTree | null> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const request = JSON.stringify({
    pid: window.pid,
    title: window.title,
    width: window.size[0],
    height: window.size[1],
    budgetSeconds: Math.max(0.5, (timeoutMs - 500) / 1000),
  });
  return new Promise((resolve) => {
    execFile(
      options.python ?? "/usr/bin/python3",
      ["-I", options.helperPath ?? HELPER_PATH, request],
      {
        env: options.env ?? process.env,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => {
        resolve(error ? null : parseHelperOutput(stdout));
      },
    );
  });
}

export function renderAccessibilityDocument(
  label: string,
  window: ActiveWindow,
  tree: AccessibilityTree,
  capturedAt: Date,
): string {
  const lines = [
    `# Accessibility tree: ${label}`,
    "",
    `Captured ${capturedAt.toISOString()} from \`${window.class}\` (pid ${window.pid}), window ${window.size[0]}×${window.size[1]}.`,
    "Each line is an AT-SPI role, the element's name in quotes, its text after a colon, and notable states in brackets. Indentation shows nesting. Positions are left out because Wayland doesn't report them.",
  ];
  if (tree.truncated) {
    lines.push(
      "",
      `The tree was cut off after ${tree.nodes} elements to keep the capture fast.`,
    );
  }
  lines.push("", "```text", tree.text, "```", "");
  return lines.join("\n");
}
