import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function resolvePackagedAppBinary({
  arch = process.arch,
  executableName,
  platform,
  productName,
  releaseDir,
}) {
  if (platform === "linux") {
    // electron-builder names the x64 output linux-unpacked and suffixes every
    // other arch, e.g. linux-arm64-unpacked.
    const unpackedDirectory =
      arch === "x64" ? "linux-unpacked" : `linux-${arch}-unpacked`;
    return join(releaseDir, unpackedDirectory, executableName);
  }
  if (platform === "win32") {
    return join(releaseDir, "win-unpacked", `${productName}.exe`);
  }
  if (platform !== "darwin") {
    throw new Error(`Unsupported packaged desktop platform: ${platform}`);
  }

  const appBundleName = `${productName}.app`;
  const appBinaryRelativePath = join(
    appBundleName,
    "Contents",
    "MacOS",
    productName,
  );
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const macOutputDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
    .map((entry) => entry.name)
    .sort();

  for (const directory of macOutputDirectories) {
    const appBinary = join(releaseDir, directory, appBinaryRelativePath);
    try {
      await access(appBinary);
      return appBinary;
    } catch {
      continue;
    }
  }

  throw new Error(`No packaged ${appBundleName} found under ${releaseDir}`);
}
