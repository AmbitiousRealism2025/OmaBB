import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const desktopPackageRoot = process.cwd();

const printedConfigSchema = z
  .object({
    linux: z.object({
      target: z.array(
        z.object({ arch: z.array(z.string()), target: z.string() }),
      ),
    }),
  })
  .passthrough();

async function printConfig(args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/run-electron-builder.mjs", ...args, "--print-config"],
    {
      cwd: desktopPackageRoot,
      env: {
        BB_DESKTOP_RELEASE_CHANNEL: "latest",
        PATH: process.env.PATH,
      },
    },
  );
  return printedConfigSchema.parse(JSON.parse(stdout));
}

describe("electron-builder Linux config", () => {
  it("keeps the x64 AppImage target for x64 builds", async () => {
    const config = await printConfig(["--linux", "--x64"]);

    expect(config.linux.target).toEqual([
      { arch: ["x64"], target: "AppImage" },
    ]);
  });

  it("retargets the AppImage to arm64 only for arm64 builds", async () => {
    const config = await printConfig(["--linux", "--arm64"]);

    expect(config.linux.target).toEqual([
      { arch: ["arm64"], target: "AppImage" },
    ]);
  });
});
