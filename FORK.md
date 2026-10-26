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
- `apps/desktop/src/desktop-update-provider.ts`: app name and update URL used at run time.
- `apps/desktop/electron-builder.config.json`: the same identity, overridden at build time by the release-channel module.
- `apps/desktop/src/main.ts`: dev app name, data dir fallback, inherited thread env.
- `apps/desktop/src/types.ts`: default server URL, read from the shared port.
- `apps/server/src/services/system/cli-command.ts`: shell command name.
- `plugins/automations/src/server.ts`: fallback server URL.

## Syncing with upstream

```sh
git fetch origin
git merge origin/main
```

`origin` is `get-bb/bb` and `fork` is `AmbitiousRealism2025/OmaBB`. After a merge, grep for new hardcoded `38886`, `38887`, `".bb"` home paths, and `get-bb/bb/releases` in non-test code.
