# OmaBB

OmaBB is a fork of [bb](https://github.com/get-bb/bb) tuned for [Omarchy](https://omarchy.org), built for Linux arm64 (Omarchy on Apple Silicon through Asahi) and Linux x86_64.

## Running beside stock bb

OmaBB keeps every piece of machine-level state apart from stock bb, so both apps can be installed and running at once.

|                                       | stock bb                       | OmaBB                                 |
| ------------------------------------- | ------------------------------ | ------------------------------------- |
| Data dir                              | `~/.bb`                        | `~/.omabb`                            |
| Server port                           | 38886                          | 52886                                 |
| Host daemon port                      | 38887                          | 52887                                 |
| App name / Electron user data         | `bb` (`~/.config/bb`)          | `OmaBB` (`~/.config/OmaBB`)           |
| Dev app name                          | `bb-dev`                       | `omabb-dev`                           |
| App id                                | `dev.bb.desktop`               | `dev.omabb.desktop`                   |
| Linux executable / AppImage           | `bb`, `bb-<v>-<arch>.AppImage` | `omabb`, `OmaBB-<v>-<arch>.AppImage`  |
| Shell command installed from Settings | `~/.local/bin/bb`              | `~/.local/bin/omabb`                  |
| Update feed                           | `get-bb/bb` releases           | `AmbitiousRealism2025/OmaBB` releases |

Shared on purpose:

- Project config inside repos (`.bb/skills`, `.bb/AGENTS.md`, `.bb/plugins.json`), so a project set up for bb works in OmaBB.
- Inside a thread, agents still call the CLI as `bb`. The host daemon puts OmaBB's own CLI first on the agent's PATH, so bb's skills and guides keep working.
- `BB_*` environment variable names. A packaged OmaBB launched from a terminal inside a bb or OmaBB thread drops that thread's server URL, daemon port, and ids (`apps/desktop/src/inherited-thread-env.ts`) instead of attaching to the other install.

Not separated yet:

- Global skills installed from Settings go to `~/.agents/skills` and `~/.claude/skills`, the same folders stock bb uses.
- Hosted services (getbb.app account, connect, bb cloud) are upstream's.
- Moving a server to another machine and machine enrollment still install the upstream `bb-app` npm package and use `~/.bb-machines`.

## Where the identity lives

Keep these in mind when merging upstream; each is a small, marked edit.

- `packages/config/src/runtime.ts`: data dir name and the two ports.
- `apps/desktop/scripts/desktop-release-channel.mjs` (+ `.d.mts`): app id, app name, executable and artifact names, update URL used at build time.
- `apps/desktop/src/desktop-update-provider.ts`: app name, launcher entry id (`linuxDesktopId`) and update URL used at run time.
- `apps/desktop/electron-builder.config.json`: the same identity, overridden at build time by the release-channel module.
- `apps/desktop/src/main.ts`: dev app name, data dir fallback, inherited thread env.
- `apps/desktop/src/types.ts`: default server URL, read from the shared port.
- `apps/server/src/services/system/cli-command.ts`: shell command name.
- `plugins/automations/src/server.ts`: fallback server URL.

## OmaBB-only desktop behaviour

### Hyprland colour management

`apps/desktop/src/desktop-hyprland-color-manager.ts`. Also suitable for upstream.

- **The bug.** Hyprland 0.48.0 added `wp-color-manager-v1` (hyprwm/Hyprland#9444). It advertises `FEATURE_SET_PRIMARIES` but rejects `set_primaries` outside debug mode, and Chromium treats that as a fatal Wayland protocol error. 0.51.0 accepts the call (hyprwm/Hyprland#11499).
- **The workaround.** On the affected stock releases, 0.48.0 through 0.50.1, startup adds `WaylandWpColorManagerV1` to `--disable-features`. Chromium keeps only the last `--disable-features` switch, so the value is merged with any list already passed.
- **Which builds count.** A build is treated as affected only when its version, tag and commit all match the stock release and it isn't dirty. That leaves development builds that still report an old version on Chromium's default.
- **Hyprland detection.** Only `XDG_CURRENT_DESKTOP`/`XDG_SESSION_DESKTOP` are trusted. A stale `HYPRLAND_INSTANCE_SIGNATURE` is often inherited by other desktops.
- **Wayland detection.** Electron picks Wayland by default when `WAYLAND_DISPLAY` is set. An absent `--ozone-platform` therefore still counts as Wayland, unless `--ozone-platform-hint` or `ELECTRON_OZONE_PLATFORM_HINT` asks for X11.
- **User overrides.** A user who already enabled or disabled the feature is left alone.

### AppImage launcher entry

`apps/desktop/src/desktop-linux-integration.ts`.

- **Why.** An AppImage has no installer, so nothing adds it to the application launcher.
- **What it writes.** On each launch, a packaged AppImage writes `$XDG_DATA_HOME/applications/<linuxDesktopId>.desktop`, where `XDG_DATA_HOME` defaults to `~/.local/share`. It also writes the icon as a file path rather than a theme icon name, so no icon cache needs refreshing.
- **Keeping it current.** `Exec` follows `$APPIMAGE`, so the entry survives moves and updater renames. The icon is read and rewritten whenever the packaged icon changes. It's read and written rather than copied, because it lives inside `app.asar`.
- **Launcher refresh.** `update-desktop-database` runs as a best-effort refresh.
- **User edits.** Entries without the `X-OmaBB-Managed=true` line belong to the user and are left alone.

### Desktop update check

OmaBB's desktop version (`0.47.1-omabb.N`) differs from the bundled server's `bb-app` version (`0.47.1`), because CI stamps the suffix onto the desktop package only. The server's desktop update service (`apps/server/src/services/system/desktop-app-update.ts`) used to check a restart against the server's own version, so every OmaBB update reported "bb started 0.47.1 instead of 0.47.1-omabb.N" even though it had worked. It now checks against the version the desktop reports over the update channel, and falls back to the server's version when the desktop doesn't answer. Upstream's desktop and server versions are always equal, so this also suits upstream.

## Third-party code

The Hyprland colour-management workaround is adapted from [T3 Code](https://github.com/pingdotgg/t3code), `apps/desktop/src/app/DesktopEarlyElectronStartup.ts` at `v0.1.1`. T3 Code is under this licence:

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Syncing with upstream

```sh
git fetch origin
git merge origin/main
```

`origin` is `get-bb/bb` and `fork` is `AmbitiousRealism2025/OmaBB`. After a merge, grep for new hardcoded `38886`, `38887`, `".bb"` home paths, and `get-bb/bb/releases` in non-test code.
