// Turns an Omarchy 4 theme's colors.toml into a bb theme stylesheet.
//
// bb derives its whole neutral ramp from two anchors, --canvas and --ink, so
// the mapping sets those, the accent, the text tiers, the semantic colours and
// the terminal palette, and leaves every derived token alone.

export type OmarchyColors = Record<string, string>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Reads the `key = "#rrggbb"` lines of colors.toml. Other TOML is ignored:
 * Omarchy's colors file is flat, and only colour values matter here.
 */
export function parseColorsToml(source: string): OmarchyColors {
  const colors: OmarchyColors = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const match = /^([A-Za-z0-9_]+)\s*=\s*["']([^"']*)["']$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) colors[key] = value.trim();
  }
  return colors;
}

function hex(colors: OmarchyColors, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = colors[key];
    if (value !== undefined && HEX_COLOR.test(value))
      return value.toLowerCase();
  }
  return null;
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/**
 * The first candidate that meets WCAG AA (4.5:1) against `background`, so a
 * theme's own colours win over plain black or white; otherwise the best one.
 */
function readableOn(background: string, candidates: string[]): string {
  let best = candidates[0] ?? "#ffffff";
  for (const candidate of candidates) {
    if (contrastRatio(background, candidate) >= 4.5) return candidate;
    if (
      contrastRatio(background, candidate) > contrastRatio(background, best)
    ) {
      best = candidate;
    }
  }
  return best;
}

// The same slots Omarchy's own terminal templates use (default/themed/
// alacritty.toml.tpl), so bb's terminal matches the system terminal. A
// theme's colorN keys are the fallback.
const ANSI_SOURCES: readonly (readonly string[])[] = [
  ["background"],
  ["red"],
  ["green"],
  ["yellow"],
  ["blue"],
  ["magenta"],
  ["cyan"],
  ["foreground"],
  ["muted"],
  ["bright_red"],
  ["bright_green"],
  ["bright_yellow"],
  ["bright_blue"],
  ["bright_magenta"],
  ["bright_cyan"],
  ["bright_foreground"],
];

export interface RenderedTheme {
  css: string;
  mode: "dark" | "light";
}

export class IncompleteThemeError extends Error {}

export function renderThemeCss(
  colors: OmarchyColors,
  themeName: string,
): RenderedTheme {
  const canvas = hex(colors, "background", "color0");
  const ink = hex(colors, "foreground", "color7", "color15");
  if (canvas === null || ink === null) {
    throw new IncompleteThemeError(
      "colors.toml has no usable background and foreground colours",
    );
  }
  const accent = hex(colors, "accent", "blue", "color4") ?? ink;
  const red = hex(colors, "red", "color1") ?? accent;
  const green = hex(colors, "green", "color2") ?? accent;
  const yellow = hex(colors, "yellow", "color3") ?? accent;
  const blue = hex(colors, "blue", "color4") ?? accent;
  const magenta = hex(colors, "magenta", "color5") ?? accent;
  const cyan = hex(colors, "cyan", "color6") ?? blue;
  const orange = hex(colors, "orange") ?? yellow;
  const brightRed = hex(colors, "bright_red", "color9") ?? red;
  const brightYellow = hex(colors, "bright_yellow", "color11") ?? yellow;
  const mode = colors.mode === "light" ? "light" : "dark";

  const declarations: string[] = [
    `--canvas: ${canvas};`,
    `--ink: ${ink};`,
    `--primary: ${accent};`,
    `--primary-foreground: ${readableOn(accent, [canvas, ink, "#000000", "#ffffff"])};`,
    "--muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));",
    "--subtle-foreground: color-mix(in oklch, var(--ink) 58%, var(--canvas));",
    "--readback-foreground: color-mix(in oklch, var(--ink) 64%, var(--canvas));",
    `--destructive: ${red};`,
    `--destructive-text: ${readableOn(canvas, [brightRed, red])};`,
    `--warning: ${yellow};`,
    `--warning-text: ${readableOn(canvas, [brightYellow, yellow])};`,
    `--attention: ${orange};`,
    `--success: ${green};`,
    `--diff-added: ${green};`,
    `--diff-removed: ${red};`,
    `--pr-merged: ${magenta};`,
    `--file-accent: ${cyan};`,
  ];
  for (const [index, keys] of ANSI_SOURCES.entries()) {
    const ansi = hex(colors, ...keys, `color${index}`);
    if (ansi === null) continue;
    declarations.push(`--ansi-${index}: ${ansi};`);
    declarations.push(
      `--ansi-bg-fg-${index}: ${readableOn(ansi, ["#000000", "#ffffff"])};`,
    );
  }

  // Omarchy themes have one palette, so it applies in both of bb's modes.
  const body = declarations.map((line) => `  ${line}`).join("\n");
  const css = [
    `/* Generated from the Omarchy theme "${themeName.replaceAll("*/", "")}" (${mode}). */`,
    "/* bb-plugin-omarchy-theme rewrites this file; edits are overwritten. */",
    ":root,",
    ".light,",
    ".dark {",
    body,
    "}",
    "",
  ].join("\n");
  return { css, mode };
}
