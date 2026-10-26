import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpcContract } from "../contract.ts";

describe("rpcContract", () => {
  it("accepts the apply inputs the settings page sends", () => {
    const apply = rpcContract.apply.input;
    assert.ok(apply.safeParse({ action: "install", shortcut: "SUPER + S", proposalId: "p" }).success);
    assert.ok(apply.safeParse({ action: "remove", proposalId: "p" }).success);
  });

  it("rejects apply inputs without a reviewed proposal or with stray fields", () => {
    const apply = rpcContract.apply.input;
    assert.equal(apply.safeParse({ action: "remove" }).success, false);
    assert.equal(apply.safeParse({ action: "install", shortcut: "SUPER + S" }).success, false);
    assert.equal(apply.safeParse({ action: "remove", proposalId: "p", extra: 1 }).success, false);
  });

  it("accepts both preview inputs", () => {
    assert.ok(rpcContract.preview.input.safeParse({ action: "install", shortcut: "SUPER + S" }).success);
    assert.ok(rpcContract.preview.input.safeParse({ action: "remove" }).success);
  });
});
