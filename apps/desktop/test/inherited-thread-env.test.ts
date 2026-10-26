import { describe, expect, it } from "vitest";
import { stripInheritedThreadEnv } from "../src/inherited-thread-env.js";

describe("stripInheritedThreadEnv", () => {
  it("drops a parent thread's server, daemon port, and ids", () => {
    const env: NodeJS.ProcessEnv = {
      BB_CLI: "/opt/bb/bb",
      BB_DATA_DIR: "/tmp/data",
      BB_ENVIRONMENT_ID: "env_1",
      BB_HOST_DAEMON_PORT: "38887",
      BB_PROJECT_ID: "proj_1",
      BB_SERVER_URL: "http://127.0.0.1:38886",
      BB_THREAD_ID: "thr_1",
      BB_THREAD_STORAGE: "/tmp/storage",
      PATH: "/usr/bin",
    };

    stripInheritedThreadEnv(env);

    expect(env).toEqual({ BB_DATA_DIR: "/tmp/data", PATH: "/usr/bin" });
  });

  it("keeps an explicit daemon port outside a thread", () => {
    const env: NodeJS.ProcessEnv = { BB_HOST_DAEMON_PORT: "40000" };

    stripInheritedThreadEnv(env);

    expect(env).toEqual({ BB_HOST_DAEMON_PORT: "40000" });
  });
});
