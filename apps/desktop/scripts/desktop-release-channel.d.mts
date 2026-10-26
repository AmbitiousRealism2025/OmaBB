export type DesktopReleaseChannel = "latest" | "nightly";
export type DesktopBuildPlatform = "macos" | "linux" | "windows";

export interface DesktopUpdateMetadataFileNames {
  linux: "latest-linux.yml" | "nightly-linux.yml";
  macos: "latest-mac.yml" | "nightly-mac.yml";
  windows: "latest.yml" | "nightly.yml";
}

export interface DesktopReleaseConfig {
  appId: "dev.omabb.desktop" | "dev.omabb.desktop.nightly";
  applicationName: "OmaBB" | "OmaBB Nightly";
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  linuxExecutableName: "omabb" | "omabb-nightly";
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  releaseTag: "desktop-latest" | "desktop-nightly";
  updateMetadataFileNames: DesktopUpdateMetadataFileNames;
  windowsInstallName: "omabb" | "omabb-nightly";
}

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function resolveDesktopBuildPlatform(
  nodePlatform: string,
): DesktopBuildPlatform;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseTag: DesktopReleaseConfig["releaseTag"],
): string;
