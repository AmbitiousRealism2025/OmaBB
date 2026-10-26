import { describe, expect, it } from "vitest";
import {
  DESKTOP_ENTRY_MARKER,
  escapeDesktopEntryExecArgument,
  renderDesktopEntry,
  syncAppImageDesktopEntry,
  type SyncAppImageDesktopEntryArgs,
} from "../src/desktop-linux-integration.js";

const ICON_SOURCE = "/opt/omabb/resources/app.asar/assets/icon.png";
const ENTRY_PATH = "/home/me/.local/share/applications/omabb.desktop";
const ICON_PATH = "/home/me/.local/share/icons/hicolor/512x512/apps/omabb.png";

function memoryFs(files: Record<string, string | Buffer> = {}) {
  const store = new Map<string, Buffer>(
    Object.entries(files).map(([path, content]) => [
      path,
      Buffer.from(content),
    ]),
  );
  const copies: string[] = [];
  return {
    copies,
    store,
    fs: {
      copyFile: (source: string, target: string) => {
        const bytes = store.get(source);
        if (bytes === undefined) throw new Error(`missing ${source}`);
        store.set(target, bytes);
        copies.push(target);
      },
      mkdir: () => {},
      readBytes: (path: string) => store.get(path) ?? null,
      readFile: (path: string) => store.get(path)?.toString("utf8") ?? null,
      writeFile: (path: string, content: string) => {
        store.set(path, Buffer.from(content));
      },
    },
  };
}

function sync(
  overrides: Partial<SyncAppImageDesktopEntryArgs> & {
    fs: SyncAppImageDesktopEntryArgs["fs"];
  },
) {
  return syncAppImageDesktopEntry({
    applicationName: "OmaBB",
    desktopId: "omabb",
    env: { APPIMAGE: "/home/me/Applications/OmaBB/OmaBB.AppImage" },
    homeDirectory: "/home/me",
    iconSourcePath: ICON_SOURCE,
    platform: "linux",
    ...overrides,
  });
}

describe("AppImage desktop entry", () => {
  it("writes an entry and icon on first launch", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "png" });
    const changed: string[] = [];
    const result = sync({
      fs: memory.fs,
      onEntryChanged: (dir) => changed.push(dir),
    });

    expect(result).toBe("written");
    const entry = memory.store.get(ENTRY_PATH)?.toString("utf8") ?? "";
    expect(entry).toContain(
      "Exec=/home/me/Applications/OmaBB/OmaBB.AppImage %U",
    );
    expect(entry).toContain(`Icon=${ICON_PATH}`);
    expect(entry).toContain("StartupWMClass=omabb");
    expect(entry).toContain(DESKTOP_ENTRY_MARKER);
    expect(memory.store.get(ICON_PATH)?.toString()).toBe("png");
    expect(changed).toEqual(["/home/me/.local/share/applications"]);
  });

  it("does nothing when nothing changed", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "png" });
    sync({ fs: memory.fs });
    memory.copies.length = 0;

    expect(sync({ fs: memory.fs })).toBe("unchanged");
    expect(memory.copies).toEqual([]);
  });

  it("follows the AppImage when it moves", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "png" });
    sync({ fs: memory.fs });

    const result = sync({
      fs: memory.fs,
      env: { APPIMAGE: "/home/me/Applications/OmaBB-0.48.0-arm64.AppImage" },
    });
    expect(result).toBe("written");
    expect(memory.store.get(ENTRY_PATH)?.toString("utf8")).toContain(
      "Exec=/home/me/Applications/OmaBB-0.48.0-arm64.AppImage %U",
    );
  });

  it("recopies the icon when the packaged icon changes", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "old" });
    sync({ fs: memory.fs });
    memory.store.set(ICON_SOURCE, Buffer.from("new"));

    sync({ fs: memory.fs });
    expect(memory.store.get(ICON_PATH)?.toString()).toBe("new");
  });

  it("leaves an entry without the marker alone", () => {
    const userEntry = "[Desktop Entry]\nName=My OmaBB\nExec=/somewhere/else\n";
    const memory = memoryFs({ [ICON_SOURCE]: "png", [ENTRY_PATH]: userEntry });

    expect(sync({ fs: memory.fs })).toBe("user-owned");
    expect(memory.store.get(ENTRY_PATH)?.toString("utf8")).toBe(userEntry);
    expect(memory.copies).toEqual([]);
  });

  it("honours XDG_DATA_HOME", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "png" });
    sync({
      fs: memory.fs,
      env: { APPIMAGE: "/a/OmaBB.AppImage", XDG_DATA_HOME: "/data" },
    });
    expect(memory.store.has("/data/applications/omabb.desktop")).toBe(true);
  });

  it("only runs for AppImages on Linux", () => {
    const memory = memoryFs({ [ICON_SOURCE]: "png" });
    expect(sync({ fs: memory.fs, env: {} })).toBe("not-appimage");
    expect(sync({ fs: memory.fs, env: { APPIMAGE: "relative/path" } })).toBe(
      "not-appimage",
    );
    expect(sync({ fs: memory.fs, platform: "darwin" })).toBe("not-appimage");
    expect(memory.store.has(ENTRY_PATH)).toBe(false);
  });
});

describe("desktop entry escaping", () => {
  it("leaves plain paths unquoted", () => {
    expect(escapeDesktopEntryExecArgument("/opt/OmaBB.AppImage")).toBe(
      "/opt/OmaBB.AppImage",
    );
  });

  it("quotes and escapes paths with reserved characters", () => {
    expect(
      escapeDesktopEntryExecArgument("/home/me/My Apps/Oma$BB 100%.AppImage"),
    ).toBe(String.raw`"/home/me/My Apps/Oma\\$BB 100%%.AppImage"`);
  });

  it("renders a complete entry", () => {
    expect(
      renderDesktopEntry({
        applicationName: "OmaBB",
        appImagePath: "/a/OmaBB.AppImage",
        desktopId: "omabb",
        iconPath: "/i/omabb.png",
      }).split("\n"),
    ).toEqual([
      "[Desktop Entry]",
      "# Written by the app on each launch. Delete the X-OmaBB-Managed line to",
      "# keep your own edits.",
      "Type=Application",
      "Name=OmaBB",
      "Exec=/a/OmaBB.AppImage %U",
      "Icon=/i/omabb.png",
      "Terminal=false",
      "Categories=Development;",
      "StartupWMClass=omabb",
      DESKTOP_ENTRY_MARKER,
      "",
    ]);
  });
});
