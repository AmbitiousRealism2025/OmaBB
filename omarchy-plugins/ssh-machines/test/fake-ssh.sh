#!/bin/sh
# Stands in for ssh in tests: runs the remote command (the last argument)
# through $FAKE_LOGIN_SHELL, the way sshd hands it to the user's login shell.
# FAKE_SSH_EXIT forces an exit code, as when the connection fails.
if [ -n "${FAKE_SSH_EXIT:-}" ]; then
  echo "ssh: connect to host example port 22: Connection refused" >&2
  exit "$FAKE_SSH_EXIT"
fi
for last; do :; done
exec "${FAKE_LOGIN_SHELL:-sh}" -c "$last"
