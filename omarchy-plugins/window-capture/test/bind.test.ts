import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  applyEdit,
  captureCommand,
  findConflicts,
  formatShortcut,
  installedShortcut,
  parseShortcut,
  planEdit,
  proposalId,
  renderBlock,
  resolveHyprlandConfig,
  type Shortcut,
} from "../bind.ts";
import type { RunTool } from "../hyprland.ts";

const MARKER = "bb-plugin-window-capture@52886";
const COMMAND = captureCommand(
  "http://127.0.0.1:52886/api/v1/plugins/bb-plugin-window-capture/http/capture",
);

function shortcut(input: string): Shortcut {
  const parsed = parseShortcut(input);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problem);
  return parsed.shortcut;
}

describe("parseShortcut", () => {
  it("normalises modifier order, aliases and case", () => {
    assert.equal(formatShortcut(shortcut("shift+control super s")), "SUPER + CTRL + SHIFT + S");
    assert.equal(formatShortcut(shortcut("SUPER + ALT + print")), "SUPER + ALT + PRINT");
  });

  it("rejects shortcuts Hyprland can't bind safely", () => {
    for (const input of ["", "SUPER", "SUPER + A + B", "S", "SUPER + a-b"]) {
      assert.equal(parseShortcut(input).ok, false, input);
    }
  });
});

describe("renderBlock", () => {
  it("writes a Lua hl.bind with the command in a long string", () => {
    const [begin, body, end] = renderBlock("lua", MARKER, shortcut("SUPER+CTRL+SHIFT+S"), COMMAND);
    assert.match(begin ?? "", /^-- >>> window-capture bb-plugin-window-capture@52886 begin/);
    assert.equal(
      body,
      `hl.bind("SUPER + CTRL + SHIFT + S", hl.dsp.exec_cmd([[${COMMAND}]]), { description = "Capture window to bb" })`,
    );
    assert.equal(end, "-- <<< window-capture bb-plugin-window-capture@52886 end");
  });

  it("picks a long-string level that the command can't close", () => {
    const [, body] = renderBlock("lua", MARKER, shortcut("SUPER+S"), "echo ]] ]=]");
    assert.match(body ?? "", /exec_cmd\(\[==\[echo \]\] \]=\]\]==\]\)/);
  });

  it("writes a bindd line for hyprland.conf", () => {
    const [begin, body] = renderBlock("conf", MARKER, shortcut("SUPER+CTRL+SHIFT+S"), COMMAND);
    assert.match(begin ?? "", /^# >>> window-capture/);
    assert.equal(body, `bindd = SUPER CTRL SHIFT, S, Capture window to bb, exec, ${COMMAND}`);
  });
});

describe("planEdit", () => {
  const original = 'require("hypr.extra")\no.bind("SUPER + E", "Files", "nautilus")\n';
  const install = { action: "install", shortcut: shortcut("SUPER+CTRL+SHIFT+S"), command: COMMAND } as const;

  it("appends the block, then removes it back to the original bytes", () => {
    const installed = planEdit(original, "lua", MARKER, install);
    assert.deepEqual(installed.removed, []);
    assert.equal(installed.added.length, 3);
    assert.ok(installed.after.startsWith(original));
    const removed = planEdit(installed.after, "lua", MARKER, { action: "remove" });
    assert.equal(removed.after, original);
    assert.deepEqual(removed.removed, installed.added);
  });

  it("replaces an existing block instead of adding a second one", () => {
    const first = planEdit(original, "lua", MARKER, install).after;
    const second = planEdit(first, "lua", MARKER, {
      ...install,
      shortcut: shortcut("SUPER+ALT+PRINT"),
    });
    assert.equal(second.after.split(">>> window-capture").length - 1, 1);
    assert.equal(installedShortcut(second.after, "lua", MARKER)?.shortcut, "SUPER + ALT + PRINT");
  });

  it("leaves another server's block alone", () => {
    const stock = planEdit(original, "lua", "bb-plugin-window-capture@38886", install).after;
    const both = planEdit(stock, "lua", MARKER, install).after;
    const removed = planEdit(both, "lua", MARKER, { action: "remove" }).after;
    assert.equal(removed, stock);
  });

  it("refuses to edit a block without its end marker", () => {
    const broken = `${original}-- >>> window-capture ${MARKER} begin\nhl.bind("X")\n`;
    assert.throws(() => planEdit(broken, "lua", MARKER, { action: "remove" }), /no end marker/);
  });
});

describe("installedShortcut", () => {
  it("reads the shortcut and command back from either format", () => {
    for (const format of ["lua", "conf"] as const) {
      const content = planEdit("", format, MARKER, {
        action: "install",
        shortcut: shortcut("SUPER+SHIFT+PRINT"),
        command: COMMAND,
      }).after;
      assert.deepEqual(installedShortcut(content, format, MARKER), {
        shortcut: "SUPER + SHIFT + PRINT",
        command: COMMAND,
      });
    }
    assert.equal(installedShortcut("hl.bind()\n", "lua", MARKER), null);
  });
});

describe("resolveHyprlandConfig", () => {
  const existsIn = (paths: string[]) => async (path: string) => paths.includes(path);

  it("prefers bindings.lua next to hyprland.lua", async () => {
    const location = await resolveHyprlandConfig({}, "/home/u", existsIn([
      "/home/u/.config/hypr/hyprland.lua",
      "/home/u/.config/hypr/bindings.lua",
    ]));
    assert.deepEqual(location, { path: "/home/u/.config/hypr/bindings.lua", format: "lua" });
  });

  it("skips an XDG_CONFIG_HOME that has no Hyprland config", async () => {
    const location = await resolveHyprlandConfig(
      { XDG_CONFIG_HOME: "/elsewhere" },
      "/home/u",
      existsIn(["/home/u/.config/hypr/hyprland.conf"]),
    );
    assert.deepEqual(location, { path: "/home/u/.config/hypr/hyprland.conf", format: "conf" });
  });

  it("returns null without any Hyprland config", async () => {
    assert.equal(await resolveHyprlandConfig({}, "/home/u", existsIn([])), null);
  });
});

describe("findConflicts", () => {
  const binds = JSON.stringify([
    { modmask: 69, key: "S", arg: "omarchy-share", description: "Share" },
    { modmask: 69, key: "S", arg: COMMAND, description: "Capture window to bb" },
    { modmask: 64, key: "S", arg: "scratchpad", description: "Scratchpad" },
  ]);
  const run: RunTool = async () => ({ stdout: binds });

  it("lists other binds on the same keys and ignores its own", async () => {
    assert.deepEqual(
      await findConflicts(shortcut("SUPER+CTRL+SHIFT+S"), COMMAND, {}, run),
      ["Share"],
    );
  });
});

describe("applyEdit", () => {
  let directory = "";
  const change = { action: "install", shortcut: shortcut("SUPER+CTRL+SHIFT+S"), command: COMMAND } as const;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "window-capture-bind-"));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function setup(name: string, content: string) {
    const path = join(directory, name);
    await writeFile(path, content, { mode: 0o640 });
    const planned = planEdit(content, "lua", MARKER, change);
    return { path, planned, id: proposalId(path, content, planned.after) };
  }

  function fakeHyprctl(errorsAfterReload: string[]) {
    const calls: string[] = [];
    let reloads = 0;
    const run: RunTool = async (_file, args) => {
      calls.push(args.join(" "));
      if (args[0] === "reload") reloads += 1;
      if (args.includes("configerrors")) {
        return { stdout: JSON.stringify(reloads === 1 ? errorsAfterReload : [""]) };
      }
      return { stdout: "ok" };
    };
    return { run, calls };
  }

  it("writes the reviewed edit, keeps the mode and a backup, and reloads", async () => {
    const { path, planned, id } = await setup("ok.lua", "local x = 1\n");
    const { run, calls } = fakeHyprctl([""]);
    const result = await applyEdit({ path, format: "lua" }, MARKER, change, id, {}, run, () => 42);
    assert.equal(await readFile(path, "utf8"), planned.after);
    assert.equal((await stat(path)).mode & 0o777, 0o640);
    assert.equal(result.backupPath, `${path}.bak.window-capture.42`);
    assert.equal(await readFile(result.backupPath, "utf8"), "local x = 1\n");
    assert.ok(calls.includes("reload"));
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.includes("window-capture-")),
      [],
    );
  });

  it("refuses when the file changed after review", async () => {
    const { path, id } = await setup("changed.lua", "local x = 1\n");
    await writeFile(path, "local x = 2\n");
    const { run } = fakeHyprctl([""]);
    await assert.rejects(
      applyEdit({ path, format: "lua" }, MARKER, change, id, {}, run),
      /changed since you reviewed/,
    );
    assert.equal(await readFile(path, "utf8"), "local x = 2\n");
  });

  it("restores the original when Hyprland reports a new config error", async () => {
    const { path, id } = await setup("broken.lua", "local x = 1\n");
    const { run, calls } = fakeHyprctl(["bindings.lua:3: bad bind"]);
    await assert.rejects(
      applyEdit({ path, format: "lua" }, MARKER, change, id, {}, run),
      /original config is back: bindings.lua:3: bad bind/,
    );
    assert.equal(await readFile(path, "utf8"), "local x = 1\n");
    assert.equal(calls.filter((call) => call === "reload").length, 2);
  });
});
