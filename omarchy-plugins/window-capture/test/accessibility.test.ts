import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  HELPER_PATH,
  parseHelperOutput,
  readAccessibilityTree,
  renderAccessibilityDocument,
} from "../accessibility.ts";
import type { ActiveWindow } from "../hyprland.ts";

const FAKE_PYTHON = fileURLToPath(new URL("./fake-python.sh", import.meta.url));

const WINDOW: ActiveWindow = {
  address: "0x1",
  pid: 4242,
  class: "org.gnome.Nautilus",
  title: "Downloads",
  at: [0, 0],
  size: [800, 600],
};

describe("parseHelperOutput", () => {
  it("returns a matched tree", () => {
    assert.deepEqual(
      parseHelperOutput('{"matched": true, "text": "frame \\"Downloads\\"\\n  button \\"Back\\"", "nodes": 2, "truncated": false}'),
      { text: 'frame "Downloads"\n  button "Back"', nodes: 2, truncated: false },
    );
  });

  it("drops a frame with nothing inside, as Chromium reports without accessibility on", () => {
    assert.equal(parseHelperOutput('{"matched": true, "text": "frame \\"bb\\"", "nodes": 1, "truncated": false}'), null);
  });

  it("returns null for no match or garbage", () => {
    assert.equal(parseHelperOutput('{"matched": false, "reason": "no-unique-match"}'), null);
    assert.equal(parseHelperOutput("Traceback (most recent call last):"), null);
    assert.equal(parseHelperOutput('{"matched": true}'), null);
  });
});

describe("readAccessibilityTree", () => {
  it("passes the window to the helper and parses its answer", async () => {
    const tree = await readAccessibilityTree(WINDOW, {
      python: FAKE_PYTHON,
      env: { ...process.env, FAKE_PYTHON_MODE: "echo" },
    });
    assert.ok(tree);
    const request = JSON.parse(tree.text);
    assert.equal(request.pid, 4242);
    assert.equal(request.title, "Downloads");
    assert.equal(request.width, 800);
    assert.equal(request.height, 600);
  });

  it("gives up quietly when the helper hangs", async () => {
    const started = Date.now();
    const tree = await readAccessibilityTree(WINDOW, {
      python: FAKE_PYTHON,
      timeoutMs: 300,
      env: { ...process.env, FAKE_PYTHON_MODE: "hang" },
    });
    assert.equal(tree, null);
    assert.ok(Date.now() - started < 2_000);
  });
});

describe("atspi_tree.py", () => {
  const python = spawnSync("/usr/bin/python3", [
    "-c",
    "import gi; gi.require_version('Atspi', '2.0')",
  ]);

  it("parses", { skip: python.status !== 0 && "needs /usr/bin/python3 with PyGObject" }, () => {
    const result = spawnSync(
      "/usr/bin/python3",
      ["-I", "-c", "import ast, sys; ast.parse(open(sys.argv[1]).read())", HELPER_PATH],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  });
});

describe("renderAccessibilityDocument", () => {
  it("explains the format and notes truncation", () => {
    const document = renderAccessibilityDocument(
      "org.gnome.Nautilus — Downloads",
      WINDOW,
      { text: 'frame "Downloads"', nodes: 1500, truncated: true },
      new Date("2026-10-26T21:00:00.000Z"),
    );
    assert.match(document, /^# Accessibility tree: org\.gnome\.Nautilus — Downloads\n/);
    assert.match(document, /pid 4242\), window 800×600/);
    assert.match(document, /cut off after 1500 elements/);
    assert.match(document, /```text\nframe "Downloads"\n```\n$/);
  });
});
