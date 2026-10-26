// Pure target checks, shared by the server and the browser-side form.

export interface SshTarget {
  /** An SSH alias from ~/.ssh/config, `host`, or `user@host`. */
  host: string;
  port?: number;
  identityFile?: string;
}

const HOST_PATTERN = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:%[\]-]+$/;

/** A reason the target can't be used, or null when it's fine. */
export function targetProblem(target: SshTarget): string | null {
  const host = target.host.trim();
  if (host.length === 0) return "Enter a host, user@host, or SSH alias.";
  if (host.startsWith("-") || !HOST_PATTERN.test(host)) {
    return `"${target.host}" isn't a valid host, user@host, or SSH alias.`;
  }
  if (
    target.port !== undefined &&
    (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)
  ) {
    return "The port must be a whole number from 1 to 65535.";
  }
  if (
    target.identityFile !== undefined &&
    /[\n\r\0]/.test(target.identityFile)
  ) {
    return "The identity file path can't contain line breaks.";
  }
  return null;
}
