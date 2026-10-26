import { useEffect, useId, useState } from "react";
import {
  definePluginApp,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { targetProblem } from "./target.ts";

const PROVIDER_ID = "ssh-machines";

const INPUT_CLASS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function field(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" || typeof entry === "number"
    ? String(entry)
    : "";
}

function SshMachineInputs({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const id = useId();
  const [host, setHost] = useState(() => field(value, "host"));
  const [port, setPort] = useState(() => field(value, "port"));
  const [identityFile, setIdentityFile] = useState(() =>
    field(value, "identityFile"),
  );

  useEffect(() => {
    const trimmedPort = port.trim();
    const portNumber = trimmedPort === "" ? undefined : Number(trimmedPort);
    const target = {
      host: host.trim(),
      ...(portNumber === undefined ? {} : { port: portNumber }),
      ...(identityFile.trim() === ""
        ? {}
        : { identityFile: identityFile.trim() }),
    };
    const problem = targetProblem(target);
    onChange(
      problem === null
        ? { status: "ready", value: target }
        : { status: "blocked", reason: problem },
    );
  }, [host, port, identityFile, onChange]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-host`}>
        Host
        <input
          id={`${id}-host`}
          className={INPUT_CLASS}
          placeholder="mini, me@mac-mini.tailnet.ts.net, or an SSH alias"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="flex gap-3">
        <label
          className="flex w-28 flex-col gap-1 text-sm"
          htmlFor={`${id}-port`}
        >
          Port
          <input
            id={`${id}-port`}
            className={INPUT_CLASS}
            inputMode="numeric"
            placeholder="22"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <label
          className="flex flex-1 flex-col gap-1 text-sm"
          htmlFor={`${id}-identity`}
        >
          Identity file (optional)
          <input
            id={`${id}-identity`}
            className={INPUT_CLASS}
            placeholder="~/.ssh/id_ed25519"
            value={identityFile}
            onChange={(event) => setIdentityFile(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        The bb server machine must reach this box with ssh and no password
        prompt, and the box needs Node, npm and curl.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: PROVIDER_ID,
    component: SshMachineInputs,
  });
});
