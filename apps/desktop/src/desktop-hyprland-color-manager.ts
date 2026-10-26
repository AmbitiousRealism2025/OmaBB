// Hyprland 0.48.0 added wp-color-manager-v1 (hyprwm/Hyprland#9444) advertising
// FEATURE_SET_PRIMARIES while rejecting set_primaries outside debug mode, which
// Chromium treats as a fatal protocol error. 0.51.0 accepts them
// (hyprwm/Hyprland#11499). Only stock builds of these releases count: matching
// the commit as well as the tag keeps later development builds that still
// report an old version and tag on Chromium's default.
//
// Adapted from T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.),
// apps/desktop/src/app/DesktopEarlyElectronStartup.ts.

export const WAYLAND_COLOR_MANAGER_FEATURE = "WaylandWpColorManagerV1";

const AFFECTED_HYPRLAND_RELEASE_COMMITS: ReadonlyMap<string, string> = new Map([
  ["0.48.0", "5ee35f914f921e5696030698e74fb5566a804768"],
  ["0.48.1", "29e2e59fdbab8ed2cc23a20e3c6043d5decb5cdc"],
  ["0.49.0", "9958d297641b5c84dcff93f9039d80a5ad37ab00"],
  ["0.50.0", "c4a4c341568944bd4fb9cd503558b2de602c0213"],
  ["0.50.1", "4e242d086e20b32951fdc0ebcbfb4d41b5be8dcc"],
]);

interface ResolveDisableFeaturesArgs {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Value of --ozone-platform, or null when the switch is absent. */
  ozonePlatform: string | null;
  /** Value of --ozone-platform-hint, or null when the switch is absent. */
  ozonePlatformHint: string | null;
  enableFeatures: string | null;
  disableFeatures: string | null;
  readHyprctlVersionJson: () => string;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function featureNames(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .flatMap((entry) => entry.trim().match(/^\*?([^<:]+)/)?.[1] ?? []);
}

// A stale HYPRLAND_INSTANCE_SIGNATURE is often inherited into other desktops,
// so only trust the session's desktop names.
function isHyprlandSession(env: NodeJS.ProcessEnv): boolean {
  const desktops =
    nonEmpty(env.XDG_CURRENT_DESKTOP) ?? nonEmpty(env.XDG_SESSION_DESKTOP);
  return (desktops ?? "")
    .split(":")
    .some((name) => name.trim().toLowerCase() === "hyprland");
}

// Electron picks Wayland by default when a Wayland display is available, so an
// absent --ozone-platform still means Wayland unless a hint asks for X11.
function usesWayland(args: ResolveDisableFeaturesArgs): boolean {
  if (args.ozonePlatform !== null) return args.ozonePlatform === "wayland";
  const hint =
    nonEmpty(args.ozonePlatformHint) ??
    nonEmpty(args.env.ELECTRON_OZONE_PLATFORM_HINT);
  if (hint === "x11") return false;
  return nonEmpty(args.env.WAYLAND_DISPLAY) !== null;
}

function hasBrokenColorManager(readHyprctlVersionJson: () => string): boolean {
  try {
    const parsed: unknown = JSON.parse(readHyprctlVersionJson());
    if (typeof parsed !== "object" || parsed === null) return false;
    const { version, tag, commit, dirty } = parsed as Record<string, unknown>;
    return (
      typeof version === "string" &&
      AFFECTED_HYPRLAND_RELEASE_COMMITS.get(version) === commit &&
      tag === `v${version}` &&
      dirty === false
    );
  } catch {
    return false;
  }
}

/**
 * Returns the full --disable-features value to set, or null to leave the
 * command line alone. Chromium keeps only the last --disable-features value,
 * so the result merges any existing list.
 */
export function resolveHyprlandDisableFeatures(
  args: ResolveDisableFeaturesArgs,
): string | null {
  if (args.platform !== "linux") return null;
  if (!isHyprlandSession(args.env) || !usesWayland(args)) return null;
  if (featureNames(args.enableFeatures).includes(WAYLAND_COLOR_MANAGER_FEATURE))
    return null;
  if (
    featureNames(args.disableFeatures).includes(WAYLAND_COLOR_MANAGER_FEATURE)
  )
    return null;
  if (!hasBrokenColorManager(args.readHyprctlVersionJson)) return null;
  return args.disableFeatures === null
    ? WAYLAND_COLOR_MANAGER_FEATURE
    : `${args.disableFeatures},${WAYLAND_COLOR_MANAGER_FEATURE}`;
}
