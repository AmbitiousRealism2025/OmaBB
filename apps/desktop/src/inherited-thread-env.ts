// A thread's agent processes carry its server URL, daemon port, and ids. A
// packaged OmaBB launched from a terminal inside a bb or OmaBB thread would
// inherit them and start its host daemon on the other install's port, so the
// launch drops them when it came from a thread.
const INHERITED_THREAD_ENV_KEYS = [
  "BB_CLI",
  "BB_ENVIRONMENT_ID",
  "BB_HOST_DAEMON_PORT",
  "BB_PROJECT_ID",
  "BB_SERVER_URL",
  "BB_THREAD_ID",
  "BB_THREAD_STORAGE",
] as const;

export function stripInheritedThreadEnv(env: NodeJS.ProcessEnv): void {
  if ((env.BB_THREAD_ID ?? "").trim().length === 0) {
    return;
  }
  for (const key of INHERITED_THREAD_ENV_KEYS) {
    delete env[key];
  }
}
