# Omarchy Theme

A bb plugin that adds an **Omarchy** theme to Settings → Appearance. While it's selected, bb follows your current Omarchy theme: switch themes from the Omarchy menu and every open bb window repaints within about a second.

Works with stock bb and OmaBB. Needs Omarchy 4.0 or later.

## Install

From a checkout of this repository:

```sh
bb plugin install ./omarchy-plugins/omarchy-theme
```

From GitHub:

```sh
bb plugin install git:https://github.com/AmbitiousRealism2025/OmaBB.git@main --subdirectory omarchy-plugins/omarchy-theme
```

On OmaBB, run the same commands with `omabb` instead of `bb`. Then choose **Omarchy** in Settings → Appearance.

## How it works

- Omarchy 4 keeps the current theme in `~/.local/state/omarchy/current/` (it uses `$XDG_STATE_HOME` when set). `theme/colors.toml` holds the palette, and `theme.name` holds the theme's name.
- A background service watches that folder and also re-checks every 30 seconds. When the palette changes, the service rewrites `themes/omarchy.css` inside the plugin folder.
- bb reads a plugin theme's stylesheet each time it applies it. If Omarchy is the selected theme, the plugin re-applies it, and every window reloads it.

The mapping sets bb's two anchor colours, the accent, the text tiers, the status and diff colours, and the terminal palette. Everything else bb derives itself:

| bb token | Omarchy key |
|---|---|
| `--canvas` | `background` |
| `--ink` | `foreground` |
| `--primary` | `accent` |
| `--destructive`, `--diff-removed` | `red` |
| `--success`, `--diff-added` | `green` |
| `--warning` | `yellow` |
| `--attention` | `orange` |
| `--pr-merged` | `magenta` |
| `--file-accent` | `cyan` |
| `--ansi-0` … `--ansi-15` | the slots Omarchy's own terminal templates use: `background`, `red` … `cyan`, `foreground`, `muted`, `bright_red` … `bright_cyan`, `bright_foreground` |

Text colours drawn on the accent and on the terminal colours are whichever of the theme's colours, or black or white, reads best. Missing keys fall back to `color0`–`color15`, and values that aren't `#rrggbb` are ignored.

## Limits

- **Light themes.** bb's light/dark mode is a per-device setting, separate from the palette. The Omarchy palette applies in both modes, so a light Omarchy theme looks right, but bb's mode switch doesn't change with it. bb defaults to dark mode.
- **Where it runs.** The plugin reads the Omarchy theme on the machine running the bb server. That's the same machine in the usual local setup.
- **The stylesheet changes on disk.** If you installed from a checkout, `themes/omarchy.css` will show up as modified in git. Don't commit it.

## Development

```sh
npm install
npm test          # node --test, no extra dependencies
npm run typecheck
```
