---
name: window-capture
description: Capture the focused Hyprland window into the bb draft on screen, and install, check or remove the capture shortcut.
---

# Window capture

The Window Capture plugin puts a screenshot of the focused Hyprland window, plus its accessibility tree when the app exposes one, into the draft of the thread on screen in the bb desktop window the user focused last. It only works on the machine that runs the bb server, inside a Hyprland session.

## Commands

```sh
bb capture-window
bb capture-window shortcut
bb capture-window shortcut install "SUPER + CTRL + SHIFT + S"
bb capture-window shortcut install "SUPER + CTRL + SHIFT + S" --yes
bb capture-window shortcut remove
bb capture-window shortcut remove --yes
```

- `bb capture-window` captures whatever window is focused. Run from a terminal, that is the terminal, so this is mainly for testing. Exit code 0 means a bb window took the capture. Exit code 2 means nobody took it, so the image went to the clipboard instead. Exit code 1 means it failed, with the reason on stderr.
- `shortcut` (or `shortcut status`) prints the installed keys and the Hyprland config file.
- `shortcut install [KEYS]` and `shortcut remove` print the exact lines they would add or remove, and any bind already on those keys. They change nothing. Add `--yes` to write the file. bb keeps a backup beside it (`<file>.bak.window-capture.<time>`), reloads Hyprland, and restores the original if Hyprland reports a new config error. KEYS defaults to `SUPER + CTRL + SHIFT + S`.

Editing the user's Hyprland config is their call: show them the preview and get their agreement before running with `--yes`.

## Settings

- `accessibilityTree` (boolean, default `true`): attach the accessibility tree as a Markdown file. Change it with `bb plugin config window-capture set accessibilityTree false`.
- The plugin's settings page also has a **Capture shortcut** section that does the same as the `shortcut` commands.

## Files

Captures are stored under `<bb data dir>/plugins/window-capture/captures/` and deleted after 30 days. They are absolute paths on the bb server's machine, so a thread on another bb machine can't use them.
