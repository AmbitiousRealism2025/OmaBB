# OmaBB plan

OmaBB is bb tuned for [Omarchy](https://omarchy.org). This plan covers the work after the fork's identity and release pipeline, which are done (see `FORK.md`). Most items come from a comparison with [T3 Code](https://github.com/pingdotgg/t3code) v0.1.1 against bb 0.47.1, made on 2026-10-26.

## Ground rules

- **Platforms.** Any machine that runs Omarchy and bb: Apple Silicon Macs (Asahi), Intel Macs, ARM PCs, and x86 PCs. Every native piece ships for arm64 and x64. Macs on the tailnet are a supported part of the setup, not an edge case.
- **Omarchy 4.0 and later.** Older releases store themes differently and are out of scope.
- **Plugin first.** Use bb's plugin SDK wherever it reaches. Change core only when a plugin can't do the job, and keep those changes small so upstream merges stay easy.
- **Plugins work on bb and OmaBB.** The phase 1–4 plugins are standalone: they install on stock bb as well as OmaBB, and can be listed in bb's community marketplace. Use only the plugin SDK, don't hardcode OmaBB's data folder, ports or command name, and don't give them `omabb-` names. Plugins and features specific to OmaBB come later.
- **Send generic fixes upstream.** A fix that isn't OmaBB-specific goes to get-bb/bb too.
- **T3 Code is a reference, not a dependency.** It is MIT-licensed. Copied code keeps its copyright notice. Read its docs and source at the tag `v0.1.1`.
- **Testing.** Each phase is checked on the M1 Max (arm64), plus an x86 machine before it's marked done.

## Phases at a glance

| Phase | Work | Kind | Depends on |
|---|---|---|---|
| 0 | Linux desktop fixes | Core, small | — |
| 1 | Follow the Omarchy theme | Plugin | — |
| 2 | SSH machines | Plugin | A server address the target can reach |
| 3 | Window capture into the composer | Plugin + native helper | Phase 1 (plugin build experience) |
| 4 | Device panel (iOS Simulator, Android Emulator) | Plugin | Phase 2 (shared host list), a Mac on the tailnet |
| Later | Ranked list at the end | Mixed | — |

## Phase 0: Linux desktop fixes

### 0a. Hyprland colour-management workaround

Hyprland 0.48–0.50 has a broken implementation of the Wayland colour-management protocol. On those versions, turn off Chromium's `WaylandWpColorManagerV1` feature at startup.

- **Approach:** core change in desktop startup (`apps/desktop/src/main.ts`, before the app is ready). Port `resolveLinuxDisableFeaturesSwitch` from T3 Code. It applies only when running under Wayland in a Hyprland session, and only if the user hasn't already enabled or disabled the feature. It reads the version from `hyprctl version -j` and merges with any existing `--disable-features` value.
- **T3 Code:** `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`.
- **Done when:**
  - Unit tests cover each condition.
  - On Hyprland outside 0.48–0.50, or on X11, the command line is unchanged.
  - The change is offered upstream.

### 0b. AppImage desktop integration

T3 Code writes its own `.desktop` file and registers a URL scheme, which fixes OAuth callbacks for AppImage installs. **bb registers no custom URL scheme** (no `setAsDefaultProtocolClient` in `apps/desktop/src`), so the OAuth half doesn't apply. The desktop-entry half does: today OmaBB's launcher entry and icon were written by hand.

- **Approach:**
  - When running as an AppImage (`$APPIMAGE` is set), write `~/.local/share/applications/omabb.desktop` and the icon on first launch. Set `StartupWMClass=omabb`.
  - Rewrite the entry if the AppImage moves, or if the updater renames it (the `appimage-filename-updated` event).
  - Don't overwrite an entry the user has edited.
- **T3 Code:** `apps/desktop/src/app/DesktopLinuxUrlHandler.ts`.
- **Done when:**
  - A fresh AppImage install appears in the Omarchy launcher with the right icon after one launch.
  - The entry survives an update.
- **Open question:** does any bb sign-in flow (getbb.app account, bb connect) need a URL scheme on Linux? Check before dropping that half for good.

## Phase 1: Follow the Omarchy theme

A setting, **Follow Omarchy theme**, that keeps the app's palette in sync with the current Omarchy theme, in bb and OmaBB alike. This is a popular feature in other Omarchy apps.

**What exists (checked on Omarchy 4.0.2):**
- The current theme is in `~/.local/state/omarchy/current/theme/`, and its name is in `../theme.name`.
- `colors.toml` holds:
  - `mode` (dark or light)
  - `accent`, `cursor`, `muted`
  - `selection`, `selection_foreground`, `selection_background`
  - `background`, `dark_background`, `darker_background`, `lighter_background`
  - `foreground`, `dark_foreground`, `light_foreground`, `bright_foreground`
  - the named colours: `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `orange`, `brown`, plus `bright_*` variants
  - `color0`–`color15`
- Omarchy runs every script in `~/.config/omarchy/hooks/theme-set.d/` with the theme name after each theme change. It also renders user templates from `~/.config/omarchy/themed/*.tpl` with `{{ colour }}` variables (`omarchy-theme-set-templates`).
- bb applies a custom theme live to every window from `<data-dir>/theme/<name>/theme.css` (activated with `bb theme set <name>`). Its tokens include:
  - surfaces: `--background`, `--foreground`, `--card`, `--popover`, `--canvas`
  - accents: `--primary`, `--accent`, `--ring`
  - text: `--muted`, `--muted-foreground`, `--subtle-foreground`
  - borders: `--border`, `--input`
  - sidebar: `--sidebar*`
  - status: `--success`, `--warning`, `--destructive`, `--attention`
  - diffs: `--diff-added`, `--diff-removed`
  - terminal: `--ansi-0`–`--ansi-15`
  - fonts: `--font-mono`, `--font-terminal`

  The full reference is in `plugins/bb-guide/skills/bb-cli/references/theming.md`.

**Approach:**
1. **Proof of concept, no app or plugin code.**
   - Add a `~/.config/omarchy/themed/bb-theme.css.tpl` template that maps Omarchy colours to bb tokens.
   - Add a `theme-set.d` hook that copies the rendered file to `<data-dir>/theme/omarchy/theme.css` and activates it with `theme set omarchy`. On OmaBB, `<data-dir>` is `~/.omabb` and the command is `omabb`; on bb they are `~/.bb` and `bb`.
   - This tests the colour mapping before any plugin work.
2. **Plugin `omarchy-theme`** (placeholder name).
   - A background service watches `colors.toml` and rebuilds `theme.css` when it changes.
   - It activates the theme through the SDK's theme API, so it finds the right data folder on bb and OmaBB.
   - A settings section adds the toggle. Turning it off restores the theme that was active before.
   - Also generate code-highlighting colours (`theme.json` `codeTheme` or `pierre-*.json`), so code blocks match.

**Light and dark mode.** The default is dark mode. In bb, light/dark is a per-client setting, separate from the server-wide palette, so following a light Omarchy theme (`mode = "light"`) is an open item to solve later. Possible routes: a plugin that sets the mode, or a small core hook.

**Done when:**
- Changing the theme from the Omarchy menu updates every open window within about a second, on both bb and OmaBB.
- The toggle turns sync off and on cleanly.
- It works on arm64 and x64.

**Open questions:**
- How to follow light themes (see above).
- Should the plugin also follow the Omarchy font (`font-set.d` hook) through `--font-mono` and `--font-terminal`?

## Phase 2: SSH machines

Add a remote box by typing `user@host` or an SSH alias. The plugin installs and enrolls it with no copy-and-paste.

**What exists:**
- bb's plugin SDK can register machine providers (`bb.experimental_machines.register`).
- Its `bootstrap({ key, executor, report, signal })` call already installs or starts the bb daemon on the target and waits for it to connect. The provider only supplies a `MachineExecutor` whose `exec({ command, stdin, timeoutMs, signal, onOutput })` runs a command over its transport.
- An SSH provider therefore mostly needs to run `ssh -o BatchMode=yes <target> -- <argv>`.
- Reference: `plugins/bb-guide/skills/bb-plugin-authoring/references/backend-machines.md`.

**Approach:**
- Plugin `ssh-machines` (placeholder name) registers an `ssh` machine provider, with inputs `{ host }` and optionally a port and identity file.
- `ephemeral: false`.
- Removing a machine runs the uninstaller over SSH.
- Keep a **shared host list**, so the same box can be marked as a device host in phase 4.

**Requirements on the target:**
- Node, npm and curl. bootstrap doesn't install OS packages, so the plugin should check for them and report anything missing.
- A route back to the server: bb connect, or a Tailscale Serve URL.

**Done when:**
- From Settings → Machines, add `user@host` for:
  - a Linux box (the mini PC)
  - a Mac (the Mac mini)
- Each one connects, runs a thread, and is removed cleanly.

**Open questions:**
- `exec` runs on the server machine and uses its SSH keys and agent. Is that acceptable, or should it run through the client?
- Does the macOS install path work unattended over SSH?

**T3 Code:** `docs/user/remote-access.md`, section "Desktop-managed SSH"; `packages/ssh/`.

**Later:**
- Multiple routes per machine (LAN, Tailscale, SSH), ordered by speed.
- Spreading new threads across machines by load.

T3 Code reference: `docs/user/remote-access.md`, sections "Reach one machine several ways" and "Balance new threads across machines".

## Phase 3: Window capture into the composer

A keybind captures the focused window and attaches it to the current thread's draft, labelled with the app name and window title. T3 Code calls this SnapShot.

**Approach, simplest first:**
1. **CLI command plus a Hyprland bind.**
   - The plugin registers a CLI command such as `capture-window`. It runs as `bb capture-window` on bb and `omabb capture-window` on OmaBB.
   - It reads the focused window with `hyprctl activewindow -j` (pid, class, title, geometry).
   - It captures that area with `grim` (installed by Omarchy) and adds the image to the active thread's draft.
   - The user binds a key in Hyprland. This machine's Hyprland config is in Lua, so the binding format differs from `hyprland.conf`.
   - Offer to write the bind for the user, the way T3 Code does: show the change, keep a backup, then reload.
2. **Native helper.**
   - Capture the exact window even when it's covered, using `hyprland-toplevel-export-v1` with `hyprland-toplevel-mapping-v1` (T3 Code's Rust helper).
   - Ship it in the plugin's host artifact, built for arm64 and x64.
3. **Accessibility tree.**
   - Attach the window's controls and text by matching AT-SPI windows on PID plus title and size.
   - AT-SPI reports `(0,0)` positions on Wayland, so don't rely on coordinates. T3 Code's notes cover this.
4. **Fallback for other desktops.** The XDG Screenshot portal, which carries no window identity.

**T3 Code:**
- `docs/user/snap-shot.md`
- `docs/internals/linux-snap-shot.md`
- `native/hyprland-snap-shot/`
- `apps/desktop/src/snapShot/HyprlandSnapShot.ts`
- `captureConfigEdit.ts`

**Done when:**
- Pressing the bind puts a correctly labelled screenshot in the current draft within about a second, on arm64 and x64.
- The bind can be installed and removed from settings.

**Open questions, answered (2026-10-26):**
- *Can a plugin add an attachment to the draft of the thread on screen?* Yes. An `experimental_appOverlay` component's `useComposer()` falls back to the route's draft, and `replace` accepts absolute-path attachments with a `hostId`. The backend publishes a realtime signal. Only desktop windows (`window.bbDesktop`) act on it, and only the one focused last, so a phone or browser tab never picks it up.
- *`no_screen_share` on Hyprland 0.56.* `hyprctl -j getprop address:<window> no_screen_share` reports the rule, and the capture refuses before running `grim`.

**Status (2026-10-26):** steps 1 and 3 are built as the `window-capture` plugin (`omarchy-plugins/window-capture`).
- The bind calls the plugin's local HTTP route with `curl`, not the CLI, because the `bb` shell command is often not installed and Node's startup would add latency. The CLI command `capture-window` exists too.
- A capture takes about 0.55 s on the M1 Max.
- The accessibility tree comes from a small PyGObject script run with the system Python, which Omarchy's base install includes. Chromium and Electron apps expose a tree only when started with accessibility on.
- Steps 2 and 4 are still open.

## Phase 4: Device panel

A **Device** tab next to a thread shows a live iOS Simulator or Android Emulator. You can tap it, and agents can drive it through tools.

**Hosts:**
- The iOS Simulator needs macOS with Xcode, so from Omarchy it runs on a Mac reached over SSH. Candidates:
  - the older Mac mini on the tailnet (check which Xcode its macOS supports)
  - a planned dedicated Mac mini or Mac Studio
- Android runs on Linux with the Android SDK and an emulator. x86 with KVM is the standard setup; arm64 Linux support is unverified.

**What T3 Code uses:** the npm packages `agent-device` (0.21.25) and `expo-device-hub` (0.15.3), per `apps/server/src/device/deviceToolVersions.json`. Android video also needs `ffmpeg` with libx264 on the device host.

**Approach:**
- Plugin `devices` (placeholder name):
  - runs the device hub on a device host from phase 2's shared host list
  - adds the panel as a thread side tab (`app.slots.experimental_tab`)
  - streams video from the hub
  - registers agent tools (`bb.agents.registerTool`) for screenshot, tap, type and launch app
- Add a "float over chat" mode later.

**T3 Code:**
- `docs/user/devices.md`
- `apps/server/src/device/`
- `apps/server/src/mcp/toolkits/device/`
- `packages/client-runtime/src/device/`

**Done when:** from Omarchy on the M1 Max, you can open a Device tab, boot an iOS Simulator on the Mac mini, watch and tap it, and an agent can take a screenshot and tap through a tool.

**Open questions:**
- Licences and maintenance status of `agent-device` and `expo-device-hub`.
- How T3 Code streams the video to the browser.
- Whether the hub can run on a machine that isn't the bb server.

## Later, ranked

1. **File checkpoints** (core): "Revert files too" when editing an earlier prompt. bb only rewinds the conversation. This is bb's biggest real gap compared with T3 Code. T3 Code: `apps/server/src/checkpointing/`, `docs/user/composer.md`.
2. **PR watcher** (plugin): check linked PRs every few minutes and wake the agent on CI failures, reviews or merge conflicts. T3 Code: `watch_pull_request`.
3. **Settle and snooze for threads** (plugin, thread list): auto-settle when the PR merges, plus "Resume at reset" after usage limits.
4. **One prompt to several models** (plugin): a send-menu item that starts one thread and worktree per model.
5. **Push, create PR, and more Git hosts** (plugin): AI-written PR text; GitLab, Forgejo or Gitea.
6. **Usage and cost page** (plugin): pooled limits across accounts and machines.
7. **Webhook automations** (plugin, using its HTTP route hook): trigger agents from GitHub and similar.
8. **Per-project settings overrides** (core), including which providers are on.
9. **Extras for inline artifacts** (plugin, extending `inline-vis`):
   - a screenshot check before the page is shown
   - embedding local images
   - MCP Apps
   - Mermaid

## Decisions

**Made (2026-10-26):**
- The phase 1–4 plugins are standalone and work on both bb and OmaBB. OmaBB-specific plugins and features come later.
- Omarchy 4.0 and later only.
- Dark mode is the default; following light themes is solved later.

**Still open:**
- **Plugin names.** The names above are placeholders.
- **Repository.** Where the standalone plugins live: one repo per plugin, or a single plugins repo.
- **Workflow.** Proposed: one branch per phase, merged into OmaBB `main` when its done-when checks pass, and one GitHub issue per phase on the OmaBB repo.
