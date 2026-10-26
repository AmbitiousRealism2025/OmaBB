import { useCallback, useEffect, useId, useState } from "react";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRpc,
  type ComposerAttachment,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "./contract.ts";
import {
  CAPTURE_CHANNEL,
  parseCaptureSignal,
  type CaptureAttachment,
} from "./signal.ts";

const FOCUS_KEY = "bb-plugin-window-capture:focused-window";

const INPUT_CLASS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md border border-input px-3 text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isDesktopWindowOnServerMachine(): boolean {
  return "bbDesktop" in window && LOOPBACK_HOSTS.has(window.location.hostname);
}

function toAttachment(
  type: ComposerAttachment["type"],
  attachment: CaptureAttachment,
): ComposerAttachment {
  const base = {
    type,
    path: attachment.path,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
  return attachment.hostId === null
    ? base
    : { ...base, hostId: attachment.hostId };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CaptureReceiver() {
  const composer = useComposer();
  const rpc = useRpc<RpcContract>();
  const [token] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!isDesktopWindowOnServerMachine()) return;
    const claim = () => localStorage.setItem(FOCUS_KEY, token);
    const release = () => {
      if (localStorage.getItem(FOCUS_KEY) === token) {
        localStorage.removeItem(FOCUS_KEY);
      }
    };
    if (document.hasFocus() || localStorage.getItem(FOCUS_KEY) === null) {
      claim();
    }
    window.addEventListener("focus", claim);
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("focus", claim);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [token]);

  useRealtime(CAPTURE_CHANNEL, (payload) => {
    if (!isDesktopWindowOnServerMachine()) return;
    const owner = localStorage.getItem(FOCUS_KEY);
    if (owner !== null && owner !== token) return;
    const capture = parseCaptureSignal(payload);
    if (capture === null) return;
    const added = [
      toAttachment("localImage", capture.image),
      ...(capture.tree === null ? [] : [toAttachment("localFile", capture.tree)]),
    ];
    void rpc
      .call("claim", { id: capture.id })
      .then(({ granted }) => {
        if (!granted) return;
        composer.replace((current) => ({
          text: current.text,
          mentions: current.mentions,
          attachments: [...current.attachments, ...added],
        }));
      })
      .catch(() => undefined);
  });

  return null;
}

interface Review {
  action: "install" | "remove";
  shortcut: string;
  configPath: string;
  removed: string[];
  added: string[];
  conflicts: string[];
  proposalId: string;
}

interface BindStatus {
  problem: string | null;
  configPath: string | null;
  installed: { shortcut: string; current: boolean } | null;
  defaultShortcut: string;
}

function ShortcutSettings() {
  const id = useId();
  const rpc = useRpc<RpcContract>();
  const [status, setStatus] = useState<BindStatus | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await rpc.call("status", {});
      setStatus(next);
      setShortcut(
        (current) =>
          current || next.installed?.shortcut || next.defaultShortcut,
      );
    } catch (failure) {
      setError(message(failure));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startReview = async (action: "install" | "remove") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const plan = await rpc.call(
        "preview",
        action === "install" ? { action, shortcut } : { action },
      );
      setReview({ action, shortcut, ...plan });
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const applyReview = async () => {
    if (review === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call(
        "apply",
        review.action === "install"
          ? {
              action: "install",
              shortcut: review.shortcut,
              proposalId: review.proposalId,
            }
          : { action: "remove", proposalId: review.proposalId },
      );
      setNotice(
        `Saved ${result.configPath} and reloaded Hyprland. The previous version is at ${result.backupPath}.`,
      );
      setReview(null);
      await refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {error ?? "Checking your Hyprland config…"}
      </p>
    );
  }

  if (status.problem !== null) {
    return <p className="text-sm text-muted-foreground">{status.problem}</p>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        {status.installed === null
          ? "No capture shortcut is installed."
          : status.installed.current
            ? `Installed: ${status.installed.shortcut}.`
            : `Installed: ${status.installed.shortcut}, but it points at another bb server address. Install it again to fix it.`}{" "}
        Config: <code>{status.configPath}</code>
      </p>
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1" htmlFor={`${id}-keys`}>
          Shortcut
          <input
            id={`${id}-keys`}
            className={INPUT_CLASS}
            value={shortcut}
            onChange={(event) => {
              setShortcut(event.target.value);
              setReview(null);
            }}
            placeholder={status.defaultShortcut}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={busy || shortcut.trim() === ""}
          onClick={() => void startReview("install")}
        >
          Review change
        </button>
        {status.installed !== null && (
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={busy}
            onClick={() => void startReview("remove")}
          >
            Remove…
          </button>
        )}
      </div>
      {review !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-input p-3">
          <p>
            {review.action === "install"
              ? "bb will make this change to "
              : "bb will remove these lines from "}
            <code>{review.configPath}</code>, keep a backup next to it, and
            reload Hyprland.
          </p>
          {review.conflicts.length > 0 && (
            <p className="text-destructive">
              {review.shortcut} is already bound to:{" "}
              {review.conflicts.join("; ")}. Both will run unless you pick
              other keys.
            </p>
          )}
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
            {[
              ...review.removed.map((line) => `- ${line}`),
              ...review.added.map((line) => `+ ${line}`),
            ].join("\n") || "No change."}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              disabled={busy}
              onClick={() => void applyReview()}
            >
              {review.action === "install" ? "Save and reload" : "Remove and reload"}
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice !== null && <p className="text-muted-foreground">{notice}</p>}
      {error !== null && <p className="text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        The shortcut captures the focused window and adds it to the draft of
        the thread on screen in the bb window you used last. GTK, Qt and
        Firefox windows also send their accessibility tree. Chromium and
        Electron apps only do if they were started with accessibility on.
      </p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "capture-receiver",
    component: CaptureReceiver,
  });
  app.slots.settingsSection({
    id: "capture-shortcut",
    title: "Capture shortcut",
    description: "Bind a key in Hyprland that captures the focused window into bb.",
    component: ShortcutSettings,
  });
});
