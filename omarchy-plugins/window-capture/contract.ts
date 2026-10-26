import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("install"), shortcut: z.string().min(1) }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
]);

export const rpcContract = {
  status: {
    input: z.object({}).strict(),
    output: z.object({
      problem: z.string().nullable(),
      configPath: z.string().nullable(),
      installed: z
        .object({ shortcut: z.string(), current: z.boolean() })
        .nullable(),
      defaultShortcut: z.string(),
    }),
  },
  preview: {
    input: changeSchema,
    output: z.object({
      configPath: z.string(),
      removed: z.array(z.string()),
      added: z.array(z.string()),
      conflicts: z.array(z.string()),
      proposalId: z.string(),
    }),
  },
  apply: {
    input: z.discriminatedUnion("action", [
      z
        .object({
          action: z.literal("install"),
          shortcut: z.string().min(1),
          proposalId: z.string().min(1),
        })
        .strict(),
      z
        .object({ action: z.literal("remove"), proposalId: z.string().min(1) })
        .strict(),
    ]),
    output: z.object({ configPath: z.string(), backupPath: z.string() }),
  },
  claim: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ granted: z.boolean() }),
  },
} satisfies PluginRpcContract;

export type RpcContract = typeof rpcContract;
