import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { sleep } from "../server.ts";

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
