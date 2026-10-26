import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachmentName,
  captureFileStem,
  captureWindowImage,
  grimGeometry,
  grimScale,
  parseActiveWindow,
  resolveSessionEnv,
  windowLabel,
  type ActiveWindow,
  type RunTool,
  type SessionProbe,
} from "../hyprland.ts";

const WINDOW: ActiveWindow = {
  address: "0xaaaaeb991ea0",
  pid: 6161,
  class: "zen",
  title: "YouTube — Zen Browser",
  at: [17, 49],
  size: [1686, 1037],
};

describe("parseActiveWindow", () => {
  it("keeps the fields a capture needs", () => {
    const parsed = parseActiveWindow(
      JSON.stringify({ ...WINDOW, mapped: true, workspace: { id: 1 } }),
    );
    assert.deepEqual(parsed, WINDOW);
  });

  it("explains an empty answer as no focused window", () => {
    assert.throws(() => parseActiveWindow("{}"), /No window is focused/);
    assert.throws(() => parseActiveWindow("Invalid"), /isn't JSON/);
  });
});

describe("labels and file names", () => {
  it("labels with the app and title, dropping a terminal spinner frame", () => {
    assert.equal(windowLabel(WINDOW), "zen — YouTube — Zen Browser");
    assert.equal(windowLabel({ ...WINDOW, class: "kitty", title: "⠋ claude" }), "kitty — claude");
    assert.equal(windowLabel({ ...WINDOW, class: "kitty", title: "kitty" }), "kitty");
  });

  it("makes attachment names safe and short", () => {
    assert.equal(attachmentName("a/b\\c\nd", "png"), "a b c d.png");
    const long = attachmentName("x".repeat(300), "png");
    assert.equal(long.length, 124);
    assert.ok(long.endsWith("….png"));
    assert.equal(attachmentName("   ", "md"), "window.md");
  });

  it("stamps capture files with the time and app", () => {
    const stem = captureFileStem(
      { ...WINDOW, class: "com.anthropic.Claude" },
      new Date("2026-10-26T21:05:09.123Z"),
    );
    assert.equal(stem, "20261026T210509-com-anthropic-claude");
  });

  it("passes the window's layout geometry to grim", () => {
    assert.equal(grimGeometry(WINDOW), "17,49 1686x1037");
  });

  it("captures at logical size, scaled down past 1920 pixels", () => {
    assert.equal(grimScale(WINDOW), "1");
    assert.equal(grimScale({ ...WINDOW, size: [3840, 2160] }), "0.5");
    assert.equal(grimScale({ ...WINDOW, size: [1000, 2600] }), "0.738");
  });
});

describe("resolveSessionEnv", () => {
  function probe(sockets: Record<string, number>, listings: Record<string, string[]>): SessionProbe {
    return {
      isSocket: async (path) => path in sockets,
      list: async (directory) => listings[directory] ?? [],
      modifiedAt: async (path) => sockets[path] ?? 0,
    };
  }

  it("keeps live session variables", async () => {
    const env = await resolveSessionEnv(
      { XDG_RUNTIME_DIR: "/run/user/1", HYPRLAND_INSTANCE_SIGNATURE: "abc_1", WAYLAND_DISPLAY: "wayland-1" },
      probe({ "/run/user/1/hypr/abc_1/.socket.sock": 1, "/run/user/1/wayland-1": 1 }, {}),
    );
    assert.equal(env.HYPRLAND_INSTANCE_SIGNATURE, "abc_1");
    assert.equal(env.WAYLAND_DISPLAY, "wayland-1");
  });

  it("finds the newest Hyprland and Wayland sockets after a restart", async () => {
    const env = await resolveSessionEnv(
      { XDG_RUNTIME_DIR: "/run/user/1", HYPRLAND_INSTANCE_SIGNATURE: "old_1", WAYLAND_DISPLAY: "wayland-0" },
      probe(
        {
          "/run/user/1/hypr/new_2/.socket.sock": 20,
          "/run/user/1/hypr/older_0/.socket.sock": 5,
          "/run/user/1/wayland-1": 20,
        },
        {
          "/run/user/1/hypr": ["old_1", "new_2", "older_0"],
          "/run/user/1": ["wayland-1", "wayland-1.lock", "hypr"],
        },
      ),
    );
    assert.equal(env.HYPRLAND_INSTANCE_SIGNATURE, "new_2");
    assert.equal(env.WAYLAND_DISPLAY, "wayland-1");
  });

  it("says so when Hyprland isn't running", async () => {
    await assert.rejects(
      resolveSessionEnv({ XDG_RUNTIME_DIR: "/run/user/1" }, probe({}, {})),
      /Hyprland isn't running/,
    );
  });
});

describe("captureWindowImage", () => {
  it("refuses a window with a no_screen_share rule instead of saving a blank image", async () => {
    const calls: string[] = [];
    const run: RunTool = async (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      return { stdout: JSON.stringify({ no_screen_share: true }) };
    };
    await assert.rejects(captureWindowImage(WINDOW, "/tmp/x.png", {}, run), /blocks screen capture/);
    assert.deepEqual(calls, [`hyprctl -j getprop address:${WINDOW.address} no_screen_share`]);
  });

  it("captures the window's area with grim", async () => {
    const calls: string[] = [];
    const run: RunTool = async (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      return { stdout: JSON.stringify({ no_screen_share: false }) };
    };
    await captureWindowImage(WINDOW, "/tmp/x.png", {}, run);
    assert.equal(calls[1], "grim -g 17,49 1686x1037 -s 1 -t png /tmp/x.png");
  });

  it("still captures on a Hyprland without getprop", async () => {
    const calls: string[] = [];
    const run: RunTool = async (file, args) => {
      calls.push(file);
      if (file === "hyprctl") throw new Error("unknown request");
      return { stdout: "" };
    };
    await captureWindowImage(WINDOW, "/tmp/x.png", {}, run);
    assert.deepEqual(calls, ["hyprctl", "grim"]);
  });
});
