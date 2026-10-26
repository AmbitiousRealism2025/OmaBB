// Omarchy Theme: a bb theme that follows the current Omarchy theme.
//
// The plugin contributes one palette, "Omarchy", to Settings → Appearance.
// bb reads a plugin theme's stylesheet from disk each time it resolves the
// theme, so a background service regenerates themes/omarchy.css whenever the
// Omarchy theme changes and, if Omarchy is the selected theme, re-applies it
// so every open window repaints.
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  IncompleteThemeError,
  parseColorsToml,
  renderThemeCss,
} from "./palette.ts";

const PACKAGE_NAME = "bb-plugin-omarchy-theme";
const THEME_ID = "omarchy";
const DEBOUNCE_MS = 250;
// fs.watch can miss a directory that is replaced, so poll as a backstop.
const POLL_MS = 30_000;

/** The installed plugin folder: the server may run from a dist/ bundle. */
function findPluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { name?: unknown }).name === PACKAGE_NAME
        ) {
          return dir;
        }
      } catch {
        // Keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not find the ${PACKAGE_NAME} folder`);
    }
    dir = parent;
  }
}

/** Omarchy 4 keeps the current theme in $XDG_STATE_HOME/omarchy/current. */
export function resolveOmarchyCurrentDir(env: NodeJS.ProcessEnv): string {
  const stateHome = env.XDG_STATE_HOME?.trim();
  const base =
    stateHome && isAbsolute(stateHome)
      ? stateHome
      : join(homedir(), ".local", "state");
  return join(base, "omarchy", "current");
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const cssPath = join(findPluginRoot(), "themes", `${THEME_ID}.css`);
  const selectionId = `plugin:${bb.pluginId}:${THEME_ID}`;
  const currentDir = resolveOmarchyCurrentDir(process.env);
  let lastProblem: string | null = null;

  function reportProblem(message: string): void {
    if (message === lastProblem) return;
    lastProblem = message;
    bb.log.warn(message);
  }

  async function sync(): Promise<void> {
    const colorsToml = await readOptional(
      join(currentDir, "theme", "colors.toml"),
    );
    if (colorsToml === null) {
      reportProblem(
        `No Omarchy theme found at ${currentDir}/theme/colors.toml. This plugin needs Omarchy 4.0 or later.`,
      );
      return;
    }
    const themeName =
      (await readOptional(join(currentDir, "theme.name")))?.trim() || "Omarchy";

    let css: string;
    try {
      css = renderThemeCss(parseColorsToml(colorsToml), themeName).css;
    } catch (error) {
      if (error instanceof IncompleteThemeError) {
        reportProblem(`Omarchy theme "${themeName}": ${error.message}`);
        return;
      }
      throw error;
    }
    lastProblem = null;

    if ((await readOptional(cssPath)) === css) return;
    await writeFile(cssPath, css);
    bb.log.info(`Updated the Omarchy palette from "${themeName}"`);

    // Re-selecting the active theme makes every window reload its stylesheet.
    const appearance = await bb.sdk.theme.get();
    if (appearance.themeId === selectionId) {
      await bb.sdk.theme.set({
        themeId: selectionId,
        faviconColor: appearance.faviconColor,
      });
    }
  }

  bb.background.service("follow-omarchy-theme", {
    async start(signal) {
      let pending: ReturnType<typeof setTimeout> | null = null;
      let running = Promise.resolve();
      const schedule = (): void => {
        if (pending !== null) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          running = running
            .then(sync)
            .catch((error: unknown) =>
              bb.log.error(
                `Could not apply the Omarchy theme: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
        }, DEBOUNCE_MS);
      };

      let watcher = null as FSWatcher | null;
      const ensureWatcher = (): void => {
        if (watcher !== null || !existsSync(currentDir)) return;
        try {
          watcher = watch(currentDir, schedule);
          watcher.on("error", () => {
            watcher?.close();
            watcher = null;
          });
        } catch {
          watcher = null;
        }
      };

      schedule();
      while (!signal.aborted) {
        ensureWatcher();
        await sleep(POLL_MS, signal);
        if (!signal.aborted) schedule();
      }
      if (pending !== null) clearTimeout(pending);
      watcher?.close();
      await running;
    },
  });
}
