import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createSshExecutor,
  encodeRemoteCommand,
  runCollecting,
  sshArguments,
  SSH_CONNECTION_FAILED,
  targetProblem,
} from "../ssh.ts";

const FAKE_SSH = fileURLToPath(new URL("./fake-ssh.sh", import.meta.url));
const SHELLS = ["sh", "bash", "zsh", "fish"].filter(
  (shell) => spawnSync("sh", ["-c", `command -v ${shell}`]).status === 0,
);

// Arguments that break naive quoting in at least one shell.
const AWKWARD = [
  "plain",
  "with space",
  "it's",
  'say "hi"',
  "$HOME `id` $(id)",
  "back\\slash \\n",
  "100% sure; rm -rf / # no",
  "line\nbreak",
  "fish (command) {brace} *glob?",
  "unicode — ✓",
  "",
];

// Prints each argument on its own NUL-terminated record.
const PRINT_ARGV = ["sh", "-c", 'for a; do printf "%s\\0" "$a"; done', "argv0"];

describe("encodeRemoteCommand", () => {
  for (const shell of SHELLS) {
    it(`round-trips awkward arguments through ${shell}`, () => {
      const output = execFileSync(
        shell,
        ["-c", encodeRemoteCommand([...PRINT_ARGV, ...AWKWARD])],
        { encoding: "utf8" },
      );
      assert.deepEqual(output.split("\0").slice(0, -1), AWKWARD);
    });

    it(`passes stdin through ${shell}`, () => {
      const output = execFileSync(shell, ["-c", encodeRemoteCommand(["cat"])], {
        encoding: "utf8",
        input: '{"secret":"stays on stdin"}',
      });
      assert.equal(output, '{"secret":"stays on stdin"}');
    });
  }

  it("uses only one pair of single quotes and no quote escapes", () => {
    const remote = encodeRemoteCommand(["echo", 'it\'s "quoted" $x']);
    assert.equal(remote.split("'").length - 1, 2);
    assert.doesNotMatch(remote, /\\'/);
  });
});

describe("sshArguments", () => {
  it("puts options before -- and the host after it", () => {
    const args = sshArguments(
      { host: "me@box", port: 2222, identityFile: "/k/id_ed25519" },
      ["true"],
    );
    const separator = args.indexOf("--");
    assert.ok(separator > 0);
    assert.equal(args[separator + 1], "me@box");
    assert.equal(args.length, separator + 3);
    assert.ok(args.includes("BatchMode=yes"));
    assert.deepEqual(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2), [
      "-p",
      "2222",
    ]);
    assert.ok(args.includes("IdentitiesOnly=yes"));
  });
});

describe("targetProblem", () => {
  it("accepts aliases, hosts, user@host and IPv6", () => {
    for (const host of [
      "mini",
      "mac-mini.tail1234.ts.net",
      "me@10.0.0.5",
      "me@fe80::1%eth0",
    ]) {
      assert.equal(targetProblem({ host }), null, host);
    }
  });

  it("rejects option injection and shell syntax", () => {
    for (const host of [
      "-oProxyCommand=evil",
      "a b",
      "box;id",
      "",
      "me@$(id)",
    ]) {
      assert.notEqual(targetProblem({ host }), null, host);
    }
  });

  it("rejects bad ports", () => {
    assert.notEqual(targetProblem({ host: "box", port: 0 }), null);
    assert.notEqual(targetProblem({ host: "box", port: 70000 }), null);
    assert.equal(targetProblem({ host: "box", port: 22 }), null);
  });
});

describe("createSshExecutor", () => {
  const executor = createSshExecutor({ host: "box" }, { sshBinary: FAKE_SSH });

  it("runs the argv remotely, streams output and returns the exit code", async () => {
    const chunks: string[] = [];
    const result = await executor.exec({
      command: [
        "sh",
        "-c",
        'read line; echo "got $line"; echo err >&2; exit 3',
      ],
      stdin: "hello\n",
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      onOutput: (chunk) => chunks.push(chunk),
    });
    assert.equal(result.exitCode, 3);
    assert.match(chunks.join(""), /got hello/);
    assert.match(chunks.join(""), /err/);
  });

  it("reports a failed connection as exit 255", async () => {
    process.env.FAKE_SSH_EXIT = String(SSH_CONNECTION_FAILED);
    try {
      const { exitCode, output } = await runCollecting(
        executor,
        ["true"],
        new AbortController().signal,
      );
      assert.equal(exitCode, SSH_CONNECTION_FAILED);
      assert.match(output, /Connection refused/);
    } finally {
      delete process.env.FAKE_SSH_EXIT;
    }
  });

  it("times out", async () => {
    await assert.rejects(
      executor.exec({
        command: ["sleep", "5"],
        stdin: "",
        timeoutMs: 200,
        signal: new AbortController().signal,
        onOutput: () => {},
      }),
      /Timed out/,
    );
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    const running = executor.exec({
      command: ["sleep", "5"],
      stdin: "",
      timeoutMs: 10_000,
      signal: controller.signal,
      onOutput: () => {},
    });
    setTimeout(() => controller.abort(new Error("user cancelled")), 100);
    await assert.rejects(running, /user cancelled/);
  });
});
