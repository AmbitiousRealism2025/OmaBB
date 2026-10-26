import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

// An AppImage has no installer, so nothing puts it in the application
// launcher. On each launch, keep a launcher entry and icon pointing at the
// running AppImage. The entry follows the AppImage when it moves or the
// updater renames it, because the next launch rewrites Exec. Entries without
// the marker belong to the user and are never touched.

export const DESKTOP_ENTRY_MARKER = "X-OmaBB-Managed=true";

interface RenderDesktopEntryArgs {
  applicationName: string;
  appImagePath: string;
  desktopId: string;
  iconPath: string;
}

// The general string-value escapes, applied after the Exec quoting rules.
function escapeDesktopEntryString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

export function escapeDesktopEntryExecArgument(value: string): string {
  if (!/[\s"'\\><~|&;$*?#()`%]/.test(value)) {
    return escapeDesktopEntryString(value);
  }
  const quoted = value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  return escapeDesktopEntryString(`"${quoted}"`);
}

export function renderDesktopEntry(args: RenderDesktopEntryArgs): string {
  return [
    "[Desktop Entry]",
    "# Written by the app on each launch. Delete the X-OmaBB-Managed line to",
    "# keep your own edits.",
    "Type=Application",
    `Name=${escapeDesktopEntryString(args.applicationName)}`,
    `Exec=${escapeDesktopEntryExecArgument(args.appImagePath)} %U`,
    `Icon=${escapeDesktopEntryString(args.iconPath)}`,
    "Terminal=false",
    "Categories=Development;",
    `StartupWMClass=${args.desktopId}`,
    DESKTOP_ENTRY_MARKER,
    "",
  ].join("\n");
}

interface DesktopIntegrationFs {
  copyFile(source: string, target: string): void;
  readBytes(path: string): Buffer | null;
  mkdir(path: string): void;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
}

const nodeFs: DesktopIntegrationFs = {
  // Read and write rather than copy: the packaged icon is inside app.asar.
  copyFile: (source, target) => writeFileSync(target, readFileSync(source)),
  readBytes: (path) => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  },
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeFile: (path, content) => writeFileSync(path, content),
};

export interface SyncAppImageDesktopEntryArgs {
  applicationName: string;
  desktopId: string;
  env: NodeJS.ProcessEnv;
  fs?: DesktopIntegrationFs;
  homeDirectory?: string;
  /** The packaged icon to install. */
  iconSourcePath: string;
  platform: NodeJS.Platform;
  /** Called after the entry changes, to refresh launcher caches. */
  onEntryChanged?: (applicationsDir: string) => void;
}

export type SyncAppImageDesktopEntryResult =
  | "not-appimage"
  | "user-owned"
  | "unchanged"
  | "written";

function resolveDataHome(
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  const configured = env.XDG_DATA_HOME?.trim();
  return configured && isAbsolute(configured)
    ? configured
    : join(homeDirectory, ".local", "share");
}

export function syncAppImageDesktopEntry(
  args: SyncAppImageDesktopEntryArgs,
): SyncAppImageDesktopEntryResult {
  const appImagePath = args.env.APPIMAGE?.trim();
  if (args.platform !== "linux" || !appImagePath || !isAbsolute(appImagePath)) {
    return "not-appimage";
  }
  const fs = args.fs ?? nodeFs;
  const dataHome = resolveDataHome(args.env, args.homeDirectory ?? homedir());
  const applicationsDir = join(dataHome, "applications");
  const entryPath = join(applicationsDir, `${args.desktopId}.desktop`);
  const existing = fs.readFile(entryPath);
  if (existing !== null && !existing.includes(DESKTOP_ENTRY_MARKER)) {
    return "user-owned";
  }

  // A path, not a theme icon name, so no icon cache needs refreshing.
  const iconPath = join(
    dataHome,
    "icons",
    "hicolor",
    "512x512",
    "apps",
    `${args.desktopId}.png`,
  );
  const sourceIcon = fs.readBytes(args.iconSourcePath);
  const installedIcon = fs.readBytes(iconPath);
  if (
    sourceIcon !== null &&
    (installedIcon === null || !installedIcon.equals(sourceIcon))
  ) {
    fs.mkdir(dirname(iconPath));
    fs.copyFile(args.iconSourcePath, iconPath);
  }

  const content = renderDesktopEntry({
    applicationName: args.applicationName,
    appImagePath,
    desktopId: args.desktopId,
    iconPath,
  });
  if (existing === content) return "unchanged";
  fs.mkdir(applicationsDir);
  fs.writeFile(entryPath, content);
  args.onEntryChanged?.(applicationsDir);
  return "written";
}

/** Best effort: launchers that don't watch the folder read this cache. */
export function refreshDesktopDatabase(applicationsDir: string): void {
  try {
    const child = spawn("update-desktop-database", [applicationsDir], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Not installed, or not spawnable: launchers rescan on their own.
  }
}
