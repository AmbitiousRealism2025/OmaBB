import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const desktopPackageRoot = process.cwd();

const printedConfigSchema = z
  .object({ extraMetadata: z.record(z.string(), z.unknown()).optional() })
  .passthrough();

async function printConfig(args: string[], channel: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/run-electron-builder.mjs", ...args, "--print-config"],
    {
      cwd: desktopPackageRoot,
      env: { BB_DESKTOP_RELEASE_CHANNEL: channel, PATH: process.env.PATH },
    },
  );
  return printedConfigSchema.parse(JSON.parse(stdout));
}

describe("electron-builder Linux desktop name", () => {
  it("names the window class after the stable executable", async () => {
    const config = await printConfig(["--linux", "--arm64"], "latest");

    expect(config.extraMetadata?.desktopName).toBe("omabb.desktop");
  });

  it("keeps the nightly window class apart from stable", async () => {
    const config = await printConfig(["--linux", "--x64"], "nightly");

    expect(config.extraMetadata?.desktopName).toBe("omabb-nightly.desktop");
  });

  it("leaves the macOS package metadata alone", async () => {
    const config = await printConfig(["--mac", "--arm64"], "latest");

    expect(config.extraMetadata?.desktopName).toBeUndefined();
  });
});
