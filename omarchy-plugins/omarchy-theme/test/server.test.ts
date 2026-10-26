import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { createPaletteApplier, sleep } from "../server.ts";

describe("sleep", () => {
  it("leaves no abort listeners behind after finishing", async () => {
    const controller = new AbortController();
    for (let index = 0; index < 20; index += 1) {
      await sleep(1, controller.signal);
    }
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  it("returns early when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    await sleep(10_000, controller.signal);
    assert.ok(Date.now() - started < 1_000);
  });
});

describe("createPaletteApplier", () => {
  function fakeTarget(failRefreshes: number) {
    const calls = { writes: 0, refreshes: 0 };
    let file: string | null = null;
    let failuresLeft = failRefreshes;
    return {
      calls,
      target: {
        readCss: async () => file,
        writeCss: async (css: string) => {
          calls.writes += 1;
          file = css;
        },
        refreshIfActive: async () => {
          calls.refreshes += 1;
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error("server busy");
          }
        },
      },
    };
  }

  it("writes and refreshes once per new palette", async () => {
    const { calls, target } = fakeTarget(0);
    const apply = createPaletteApplier(target);
    assert.equal(await apply("a"), "written");
    assert.equal(await apply("a"), "unchanged");
    assert.equal(await apply("b"), "written");
    assert.deepEqual(calls, { writes: 2, refreshes: 2 });
  });

  it("retries the refresh after a failure even though the file already matches", async () => {
    const { calls, target } = fakeTarget(1);
    const apply = createPaletteApplier(target);
    await assert.rejects(apply("a"), /server busy/);
    assert.equal(await apply("a"), "refreshed");
    assert.equal(await apply("a"), "unchanged");
    assert.deepEqual(calls, { writes: 1, refreshes: 2 });
  });

  it("refreshes once at startup when the file is already current", async () => {
    const { calls, target } = fakeTarget(0);
    await target.writeCss("a");
    calls.writes = 0;
    const apply = createPaletteApplier(target);
    assert.equal(await apply("a"), "refreshed");
    assert.deepEqual(calls, { writes: 0, refreshes: 1 });
  });
});
