export interface ResolvePackagedAppBinaryArgs {
  arch?: string;
  executableName: string;
  platform: NodeJS.Platform;
  productName: string;
  releaseDir: string;
}

export function resolvePackagedAppBinary(
  args: ResolvePackagedAppBinaryArgs,
): Promise<string>;
