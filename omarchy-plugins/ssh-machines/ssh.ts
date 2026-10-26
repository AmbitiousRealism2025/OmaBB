// Runs bb's machine commands on a box over SSH.
//
// bb's bootstrap hands the executor an argv such as
// ["sh", "-c", <script>, "bb-machine-install", <url>] plus private stdin.
// ssh joins its remote arguments into one string that the remote user's
// login shell parses, and that shell may be bash, zsh or fish, which quote
// differently. So the argv is POSIX-quoted, encoded as printf octal escapes,
// and wrapped in a fixed command whose only quoting is one pair of single
// quotes holding no quote or backslash-quote sequences. All three shells pass
// it to `sh` unchanged, and `sh` rebuilds the exact argv. stdin goes through
// untouched.
import { spawn } from "node:child_process";

import { type SshTarget } from "./target.ts";

export { targetProblem, type SshTarget } from "./target.ts";

export function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

/** The single remote command string ssh sends for `argv`. */
export function encodeRemoteCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error("No command to run");
  const command = argv.map(shellQuote).join(" ");
  const octal = [...Buffer.from(command, "utf8")]
    .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
    .join("");
  return `sh -c 'eval "$(printf "${octal}")"'`;
}

export const SSH_CONNECT_TIMEOUT_SECONDS = 15;

/** ssh's arguments, ending with the target and the encoded remote command. */
export function sshArguments(
  target: SshTarget,
  argv: readonly string[],
): string[] {
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
  if (target.port !== undefined) args.push("-p", String(target.port));
  if (target.identityFile !== undefined && target.identityFile.length > 0) {
    args.push("-i", target.identityFile, "-o", "IdentitiesOnly=yes");
  }
  args.push("--", target.host.trim(), encodeRemoteCommand(argv));
  return args;
}

/** ssh exits 255 when the connection itself fails. */
export const SSH_CONNECTION_FAILED = 255;

export interface ExecRequest {
  command: string[];
  stdin: string;
  timeoutMs: number;
  signal: AbortSignal;
  onOutput: (chunk: string) => void;
}

export interface SshExecutor {
  exec(request: ExecRequest): Promise<{ exitCode: number }>;
}

export function createSshExecutor(
  target: SshTarget,
  options: { sshBinary?: string } = {},
): SshExecutor {
  const sshBinary = options.sshBinary ?? "ssh";
  return {
    exec(request) {
      request.signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const child = spawn(sshBinary, sshArguments(target, request.command), {
          stdio: ["pipe", "pipe", "pipe"],
        });
        let settled = false;
        const finish = (error: Error | null, exitCode = 0): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal.removeEventListener("abort", onAbort);
          if (error === null) resolve({ exitCode });
          else reject(error);
        };
        const stop = (error: Error): void => {
          child.kill("SIGTERM");
          finish(error);
        };
        const onAbort = (): void =>
          stop(
            request.signal.reason instanceof Error
              ? request.signal.reason
              : new Error("Cancelled"),
          );
        const timer = setTimeout(
          () => stop(new Error(`Timed out after ${request.timeoutMs} ms`)),
          request.timeoutMs,
        );
        request.signal.addEventListener("abort", onAbort, { once: true });

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", request.onOutput);
        child.stderr.on("data", request.onOutput);
        child.on("error", (error) => finish(error));
        child.on("close", (code, signal) =>
          finish(null, code ?? (signal === null ? 1 : 128)),
        );
        // A remote command that never reads stdin closes the pipe early.
        child.stdin.on("error", () => {});
        child.stdin.end(request.stdin);
      });
    },
  };
}

/** Runs a command and collects its output, for preflight checks. */
export async function runCollecting(
  executor: SshExecutor,
  command: string[],
  signal: AbortSignal,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; output: string }> {
  let output = "";
  const { exitCode } = await executor.exec({
    command,
    stdin: "",
    timeoutMs,
    signal,
    onOutput: (chunk) => {
      output += chunk;
    },
  });
  return { exitCode, output };
}
