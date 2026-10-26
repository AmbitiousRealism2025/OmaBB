import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCaptureSignal, type CaptureSignal } from "../signal.ts";

const SIGNAL: CaptureSignal = {
  id: "c1",
  label: "zen — YouTube",
  image: {
    path: "/home/u/.omabb/plugins/bb-plugin-window-capture/captures/a.png",
    name: "zen — YouTube.png",
    mimeType: "image/png",
    sizeBytes: 1234,
    hostId: "host_abc",
  },
  tree: null,
};

describe("parseCaptureSignal", () => {
  it("accepts a capture with and without a tree", () => {
    assert.deepEqual(parseCaptureSignal(SIGNAL), SIGNAL);
    const withTree = { ...SIGNAL, tree: { ...SIGNAL.image, mimeType: "text/markdown", hostId: null } };
    assert.deepEqual(parseCaptureSignal(withTree), withTree);
  });

  it("rejects anything that isn't a capture", () => {
    for (const value of [
      null,
      "capture",
      { ...SIGNAL, id: "" },
      { ...SIGNAL, image: { ...SIGNAL.image, path: "relative.png" } },
      { ...SIGNAL, image: { ...SIGNAL.image, sizeBytes: -1 } },
      { ...SIGNAL, tree: { path: "/x" } },
      { id: "c1", label: "x", image: SIGNAL.image },
    ]) {
      assert.equal(parseCaptureSignal(value), null, JSON.stringify(value));
    }
  });
});
