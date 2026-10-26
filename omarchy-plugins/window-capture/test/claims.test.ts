import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClaims } from "../claims.ts";

describe("createClaims", () => {
  it("grants a capture to the first client only", async () => {
    const claims = createClaims(1_000);
    const waiting = claims.wait("c1");
    assert.equal(claims.grant("c1"), true);
    assert.equal(claims.grant("c1"), false);
    assert.equal(await waiting, true);
  });

  it("refuses claims for unknown or expired captures", async () => {
    const claims = createClaims(20);
    assert.equal(claims.grant("nope"), false);
    const waiting = claims.wait("c2");
    assert.equal(await waiting, false);
    assert.equal(claims.grant("c2"), false);
  });
});
