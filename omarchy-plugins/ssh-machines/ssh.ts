import { spawn } from "node:child_process";

import { type SshTarget } from "./target.ts";

export { targetProblem, type SshTarget } from "./target.ts";

export function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function encodeRemoteCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error("No command to run");
  const command = argv.map(shellQuote).join(" ");
  const octal = [...Buffer.from(command, "utf8")]
    .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
    .join("");
  return `sh -c 'eval "$(printf "${octal}")"'`;
}

export const SSH_CONNECT_TIMEOUT_SECONDS = 15;

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
        child.stdin.on("error", () => {});
        child.stdin.end(request.stdin);
      });
    },
  };
}

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
