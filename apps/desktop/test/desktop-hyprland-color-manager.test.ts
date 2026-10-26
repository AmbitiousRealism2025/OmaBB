import { describe, expect, it } from "vitest";
import {
  resolveHyprlandDisableFeatures,
  WAYLAND_COLOR_MANAGER_FEATURE,
} from "../src/desktop-hyprland-color-manager.js";

const BROKEN_HYPRLAND = JSON.stringify({
  version: "0.50.1",
  tag: "v0.50.1",
  commit: "4e242d086e20b32951fdc0ebcbfb4d41b5be8dcc",
  dirty: false,
});
const FIXED_HYPRLAND = JSON.stringify({
  version: "0.56.2",
  tag: "v0.56.2",
  commit: "efb50993780079460b0cbed1363e2166a2de1d9f",
  dirty: false,
});

function resolve(
  overrides: Partial<Parameters<typeof resolveHyprlandDisableFeatures>[0]>,
) {
  return resolveHyprlandDisableFeatures({
    env: { XDG_CURRENT_DESKTOP: "Hyprland", WAYLAND_DISPLAY: "wayland-1" },
    platform: "linux",
    ozonePlatform: null,
    ozonePlatformHint: null,
    enableFeatures: null,
    disableFeatures: null,
    readHyprctlVersionJson: () => BROKEN_HYPRLAND,
    ...overrides,
  });
}

describe("Hyprland color manager workaround", () => {
  it("disables the feature on an affected stock Hyprland release", () => {
    expect(resolve({})).toBe(WAYLAND_COLOR_MANAGER_FEATURE);
  });

  it("merges with an existing --disable-features list", () => {
    expect(resolve({ disableFeatures: "Foo,Bar" })).toBe(
      `Foo,Bar,${WAYLAND_COLOR_MANAGER_FEATURE}`,
    );
  });

  it("applies when Wayland is selected explicitly", () => {
    expect(
      resolve({
        ozonePlatform: "wayland",
        env: { XDG_CURRENT_DESKTOP: "Hyprland" },
      }),
    ).toBe(WAYLAND_COLOR_MANAGER_FEATURE);
  });

  it("leaves fixed Hyprland releases alone", () => {
    expect(
      resolve({ readHyprctlVersionJson: () => FIXED_HYPRLAND }),
    ).toBeNull();
  });

  it("leaves dirty or retagged builds of affected versions alone", () => {
    const dirty = JSON.stringify({
      ...JSON.parse(BROKEN_HYPRLAND),
      dirty: true,
    });
    const retagged = JSON.stringify({
      ...JSON.parse(BROKEN_HYPRLAND),
      commit: "abc",
    });
    expect(resolve({ readHyprctlVersionJson: () => dirty })).toBeNull();
    expect(resolve({ readHyprctlVersionJson: () => retagged })).toBeNull();
  });

  it("does nothing when hyprctl fails or prints garbage", () => {
    expect(
      resolve({
        readHyprctlVersionJson: () => {
          throw new Error("hyprctl missing");
        },
      }),
    ).toBeNull();
    expect(resolve({ readHyprctlVersionJson: () => "not json" })).toBeNull();
  });

  it("does nothing outside a Hyprland session", () => {
    expect(
      resolve({
        env: { XDG_CURRENT_DESKTOP: "GNOME", WAYLAND_DISPLAY: "wayland-0" },
      }),
    ).toBeNull();
    // A stale instance signature alone doesn't count.
    expect(
      resolve({
        env: {
          XDG_CURRENT_DESKTOP: "KDE",
          HYPRLAND_INSTANCE_SIGNATURE: "stale",
          WAYLAND_DISPLAY: "wayland-0",
        },
      }),
    ).toBeNull();
  });

  it("does nothing under X11", () => {
    expect(resolve({ ozonePlatform: "x11" })).toBeNull();
    expect(resolve({ ozonePlatformHint: "x11" })).toBeNull();
    expect(
      resolve({
        env: {
          XDG_CURRENT_DESKTOP: "Hyprland",
          WAYLAND_DISPLAY: "wayland-1",
          ELECTRON_OZONE_PLATFORM_HINT: "x11",
        },
      }),
    ).toBeNull();
    expect(resolve({ env: { XDG_CURRENT_DESKTOP: "Hyprland" } })).toBeNull();
  });

  it("respects a user who already enabled or disabled the feature", () => {
    expect(
      resolve({ enableFeatures: WAYLAND_COLOR_MANAGER_FEATURE }),
    ).toBeNull();
    expect(
      resolve({ disableFeatures: `Foo,${WAYLAND_COLOR_MANAGER_FEATURE}` }),
    ).toBeNull();
  });

  it("does nothing on other platforms", () => {
    expect(resolve({ platform: "darwin" })).toBeNull();
  });
});
