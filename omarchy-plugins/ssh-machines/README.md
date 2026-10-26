# SSH Machines

A bb plugin that adds **SSH** to the machine types in Settings → Machines. Enter a host, `user@host`, or an alias from your `~/.ssh/config`. bb connects, checks the box, then installs and enrolls its host daemon. You don't need to copy an enrollment command over by hand. Removing the machine stops and uninstalls the daemon over SSH.

Works with stock bb and OmaBB, for Linux boxes and Macs.

## Install

```sh
bb plugin install ./omarchy-plugins/ssh-machines   # from a checkout
bb plugin install git:https://github.com/AmbitiousRealism2025/OmaBB.git@main --subdirectory omarchy-plugins/ssh-machines
```

On OmaBB, use `omabb` instead of `bb`.

## What the box needs

- **SSH from the bb server machine, without a password prompt.** Use a key or an agent: the plugin runs `ssh` with `BatchMode=yes` on the machine running the bb server, with that machine's keys and `~/.ssh/config`. A Tailscale SSH or MagicDNS name works like any other host.
- **Node, npm and curl** on the `PATH` of a non-interactive SSH session. bb's installer needs them, and it doesn't install system packages. If you use mise, nvm or similar, make sure `ssh <host> 'command -v node npm curl'` finds all three.
- **A route back to the bb server:** bb connect, or a direct URL such as a Tailscale Serve address. Set it in Settings → Machines. It's the same requirement as for manually added machines.

## From the CLI

```sh
bb machine create --provider ssh-machines --inputs '{"host":"me@mac-mini"}'
bb machine create --provider ssh-machines --inputs '{"host":"mini","port":2222,"identityFile":"~/.ssh/id_ed25519"}'
bb machine remove <host-id> --yes
```

## How it works

bb's machine bootstrap (`bb.experimental_machines.bootstrap`) does the installing and enrolling. It only needs a way to run commands on the box, and the plugin supplies that over `ssh`.

**Running commands.** bb hands over each command as a list of arguments, and keeps secrets on stdin. ssh then passes the command through the remote user's login shell, which may be bash, zsh or fish, and those quote differently. So the plugin:
1. Quotes the arguments for POSIX `sh`.
2. Encodes the result as `printf` octal escapes.
3. Sends `sh -c 'eval "$(printf "…")"'`.

All four shells pass that to `sh` unchanged. The tests run it through sh, bash, zsh and fish.

**Checks.**
- Hosts that start with `-` or contain shell syntax are refused before ssh runs.
- Before installing, a quick check reports the box's system and any missing tools.

**Removal.** The plugin fetches bb's own `install.sh` from the server and runs `--uninstall --host-id <id>` on the box. bb revokes the machine's access either way, so an unreachable box never blocks removal.

The host, port and identity file path are stored with the machine. They're readable by other plugins, so never put a secret there; a key file path isn't one.

## Development

```sh
npm install
npm test          # node --test; uses a fake ssh to run commands through each shell
npm run typecheck
```
