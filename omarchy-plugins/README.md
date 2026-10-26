# Omarchy plugins

bb plugins for [Omarchy](https://omarchy.org) users. Each one installs on stock bb as well as OmaBB, and uses only the public plugin SDK. These folders aren't part of the pnpm workspace or bb's bundled plugins. Each is a standalone package with its own `package.json` and tests.

| Plugin | What it does |
|---|---|
| [`omarchy-theme`](omarchy-theme) | Adds an Omarchy theme to Settings → Appearance that follows your current Omarchy theme |
| [`ssh-machines`](ssh-machines) | Adds SSH as a machine type: enter `user@host` and bb installs and enrolls the box |
| [`window-capture`](window-capture) | A Hyprland shortcut that captures the focused window, with its accessibility tree, into the draft on screen |

Install one straight from GitHub:

```sh
bb plugin install git:https://github.com/AmbitiousRealism2025/OmaBB.git@main --subdirectory omarchy-plugins/<name>
```

The roadmap is in [`docs/omabb/PLAN.md`](../docs/omabb/PLAN.md).
