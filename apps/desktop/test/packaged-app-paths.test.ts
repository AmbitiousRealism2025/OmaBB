import { describe, expect, it } from "vitest";
import { resolvePackagedAppBinary } from "../scripts/packaged-app-paths.mjs";

describe("resolvePackagedAppBinary", () => {
  it("finds the x64 Linux build in linux-unpacked", async () => {
    await expect(
      resolvePackagedAppBinary({
        arch: "x64",
        executableName: "bb",
        platform: "linux",
        productName: "bb",
        releaseDir: "/tmp/release",
      }),
    ).resolves.toBe("/tmp/release/linux-unpacked/bb");
  });

  it("finds the arm64 Linux build in linux-arm64-unpacked", async () => {
    await expect(
      resolvePackagedAppBinary({
        arch: "arm64",
        executableName: "bb",
        platform: "linux",
        productName: "bb",
        releaseDir: "/tmp/release",
      }),
    ).resolves.toBe("/tmp/release/linux-arm64-unpacked/bb");
  });
});
