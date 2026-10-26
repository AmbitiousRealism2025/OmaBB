# Window Capture

A bb plugin for Hyprland. Press a shortcut and the focused window lands in the draft of the bb thread on screen: a screenshot, plus the window's accessibility tree as a Markdown file when the app exposes one. Each attachment is named after the app and the window title.

Works with stock bb and OmaBB. Needs Hyprland (Omarchy 4.0 or later) and the bb desktop app; captures arrive in the desktop window you used last, never in a browser tab or on your phone.

## Install

From a checkout of this repository:

```sh
bb plugin install ./omarchy-plugins/window-capture
```

From GitHub:

```sh
bb plugin install git:https://github.com/AmbitiousRealism2025/OmaBB.git@main --subdirectory omarchy-plugins/window-capture
```

On OmaBB, run the same commands with `omabb` instead of `bb`.

## Set up the shortcut

Open the plugin's page in Settings → Installed plugins → Window Capture. Under **Capture shortcut**:

1. Enter the keys. The default is `SUPER + CTRL + SHIFT + S`.
2. Choose **Review change**. bb shows the exact lines it will add, and any bind that already uses those keys.
3. Choose **Save and reload**.

bb edits `~/.config/hypr/bindings.lua` (or `hyprland.lua`, or `bindings.conf` and `hyprland.conf` on a non-Lua setup). It writes a fenced block, keeps a backup beside the file (`<file>.bak.window-capture.<time>`), writes the new file atomically, and runs `hyprctl reload`. If Hyprland reports a new config error, bb puts the original back. If the file changed between review and save, bb refuses and asks you to review again. **Remove…** takes the block out the same way.

The bind runs `curl` against this plugin's route on the local bb server, so it doesn't need the `bb` shell command installed. If bb isn't running, a notification says so. bb and OmaBB each write their own block, keyed by server port, so both can have a shortcut.

You can also capture from a terminal with `bb capture-window` (or `omabb capture-window`). It captures whatever window is focused, which from a terminal is the terminal.

## What a capture does

1. `hyprctl activewindow` gives the focused window's position, size, PID, class and title.
2. If the window has a `no_screen_share` rule, the capture stops. Hyprland 0.56 hands back an "access denied" image instead of failing, so this check keeps a blank picture out of your draft.
3. `grim` captures that area at logical size, scaled down if the long edge would pass 1920 pixels. That keeps images around 1 MB, under model size limits.
4. At the same time, `atspi_tree.py` (run with the system `/usr/bin/python3` and PyGObject, both part of Omarchy's base install) reads the window's AT-SPI tree. It matches on PID plus the exact title and size, ignores a terminal's leading spinner frame, and gives up after about 2.5 seconds. Wayland reports every window at `(0, 0)`, so positions are left out.
5. The files go to `<bb data dir>/plugins/window-capture/captures/`. Captures older than 30 days are deleted nightly.
6. The server tells every connected bb window. The desktop window you focused last adds the files to the draft of the thread it shows (or the new-thread draft) and confirms.
7. A notification says it worked. If no bb window took the capture, the image goes on the clipboard instead.

A whole capture takes about half a second on an M1 Max.

The files stay on this machine. A thread running on another bb machine can't use them yet: bb refuses to send them there and says why.

## Accessibility tree coverage

- **GTK, Qt and Firefox-based browsers** expose their trees. Firefox shows its own controls and tabs, but page content only when its accessibility service is active.
- **Chromium and Electron apps** (Chromium, Omarchy's web apps, VS Code, bb itself) build a tree only when they start with accessibility on. Turn it on with `gsettings set org.gnome.desktop.interface toolkit-accessibility true` and restart those apps, or launch them with `--force-renderer-accessibility`. Either way they get a little slower, which is why the plugin doesn't change it for you. Without it, those captures carry only the screenshot.
- **Alacritty** and apps without any accessibility support carry only the screenshot.

To skip the tree for every capture, turn off **Attach the accessibility tree** in the plugin's settings.

## Not done yet

- Capturing a window that's covered or on another workspace. That needs a native helper using `hyprland-toplevel-export-v1`, like T3 Code's.
- Other compositors, through the XDG Screenshot portal.

## Develop

```sh
cd omarchy-plugins/window-capture
npm install
npm run typecheck
npm test
```
