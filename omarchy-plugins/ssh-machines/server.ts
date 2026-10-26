// SSH Machines: add a box you can reach over SSH as a bb machine.
//
// bb's machine bootstrap already installs, enrolls and starts the host
// daemon; it only needs a way to run commands on the box. This plugin
// supplies that over ssh, checks the box first, and on removal stops and
// uninstalls the daemon it installed.
import { spawnSync } from "node:child_process";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  createSshExecutor,
  runCollecting,
  SSH_CONNECTION_FAILED,
  targetProblem,
  type SshTarget,
} from "./ssh.ts";

export const PROVIDER_ID = "ssh-machines";

export const inputsSchema = z
  .object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535).optional(),
    identityFile: z.string().trim().min(1).optional(),
  })
  .strict();

const resourceSchema = z.object({ host: z.string() }).passthrough();

// Bootstrap needs these on the box's non-interactive PATH (machine guide).
const PREFLIGHT = [
  "sh",
  "-c",
  [
    "missing=''",
    'for tool in node npm curl; do command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"; done',
    'echo "system: $(uname -sm)"',
    'if [ -n "$missing" ]; then echo "missing:$missing"; exit 3; fi',
    'echo "node: $(node --version)"',
  ].join("\n"),
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeTarget(target: SshTarget): string {
  return target.port === undefined
    ? target.host
    : `${target.host}:${target.port}`;
}

function sshAvailable(): boolean {
  return spawnSync("ssh", ["-V"], { stdio: "ignore" }).error === undefined;
}

export default async function plugin(bb: BbPluginApi) {
  bb.experimental_machines.register({
    id: PROVIDER_ID,
    displayName: "SSH",
    description:
      "Add a box you can already reach with ssh. bb installs and enrolls it for you.",
    icon: "Server",
    ephemeral: false,
    inputs: inputsSchema,

    availability() {
      return sshAvailable()
        ? { status: "available" }
        : {
            status: "unavailable",
            message:
              "Install OpenSSH on the bb server machine to add SSH machines.",
          };
    },

    validate({ inputs }) {
      const problem = targetProblem(inputs);
      return problem === null
        ? { action: "accept" }
        : { action: "refuse", message: problem };
    },

    async create({ inputs, key, checkpoint, report, signal }) {
      const target: SshTarget = inputs;
      const problem = targetProblem(target);
      if (problem !== null) return { status: "failed", message: problem };
      const executor = createSshExecutor(target);
      const label = describeTarget(target);

      try {
        report.step(`Connecting to ${label}`);
        const check = await runCollecting(executor, PREFLIGHT, signal);
        report.log(check.output);
        if (check.exitCode === SSH_CONNECTION_FAILED) {
          return {
            status: "failed",
            message: `Could not connect to ${label} with ssh. Check that \`ssh ${label}\` works without a password prompt from the bb server machine.\n${check.output.trim()}`,
          };
        }
        if (check.exitCode !== 0) {
          const missing = /missing:(.*)/.exec(check.output)?.[1]?.trim();
          return {
            status: "failed",
            message: missing
              ? `${label} needs ${missing.split(/\s+/).join(", ")} on the PATH of a non-interactive ssh session before bb can install there.`
              : `The check on ${label} failed:\n${check.output.trim()}`,
          };
        }

        // Nothing to allocate: the box exists. Checkpoint before bootstrap so
        // removal can clean up even if enrollment never finishes.
        await checkpoint({
          host: target.host,
          port: target.port ?? null,
          identityFile: target.identityFile ?? null,
        });
        const { hostId } = await bb.experimental_machines.bootstrap({
          key,
          executor,
          report,
          signal,
        });
        bb.log.info(`Enrolled ${label} as ${hostId}`);
        return {
          status: "created",
          name: target.host.replace(/^[^@]*@/, ""),
          resource: {
            host: target.host,
            port: target.port ?? null,
            identityFile: target.identityFile ?? null,
          },
        };
      } catch (error) {
        signal.throwIfAborted();
        return { status: "failed", message: message(error) };
      }
    },

    // A failed create leaves at most a half-installed daemon that bb has
    // already stopped trusting, so there is nothing to reclaim by key.
    async reconcileCleanup() {
      return { status: "removed" };
    },

    async remove({ hostId, resource, report, signal }) {
      const parsed = resourceSchema.safeParse(resource);
      if (!parsed.success) return { status: "removed" };
      const stored = parsed.data as {
        host: string;
        port?: number | null;
        identityFile?: string | null;
      };
      const target: SshTarget = {
        host: stored.host,
        ...(typeof stored.port === "number" ? { port: stored.port } : {}),
        ...(typeof stored.identityFile === "string"
          ? { identityFile: stored.identityFile }
          : {}),
      };
      const label = describeTarget(target);

      // bb revokes the machine's access whatever happens here, so a box that
      // is gone or unreachable must not block removal. Uninstalling is a
      // courtesy that cleans up the daemon and its files.
      try {
        report.step(`Uninstalling the bb daemon from ${label}`);
        const response = await fetch(
          new URL("/install.sh", bb.server.loopbackBaseUrl),
          { signal },
        );
        if (!response.ok)
          throw new Error(`install.sh: HTTP ${response.status}`);
        const installer = await response.text();
        const result = await createSshExecutor(target).exec({
          command: ["sh", "-s", "--", "--uninstall", "--host-id", hostId],
          stdin: installer,
          timeoutMs: 120_000,
          signal,
          onOutput: (chunk) => report.log(chunk),
        });
        if (result.exitCode !== 0) {
          report.log(
            `Could not uninstall from ${label} (exit ${result.exitCode}). Its access is revoked; remove ~/.bb-machines there by hand if needed.\n`,
          );
        }
      } catch (error) {
        signal.throwIfAborted();
        report.log(
          `Skipped uninstalling from ${label}: ${message(error)}. Its access is revoked.\n`,
        );
      }
      return { status: "removed" };
    },
  });
}
