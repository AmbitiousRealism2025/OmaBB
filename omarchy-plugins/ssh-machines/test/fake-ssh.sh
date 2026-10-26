#!/bin/sh
if [ -n "${FAKE_SSH_EXIT:-}" ]; then
  echo "ssh: connect to host example port 22: Connection refused" >&2
  exit "$FAKE_SSH_EXIT"
fi
for last; do :; done
exec "${FAKE_LOGIN_SHELL:-sh}" -c "$last"
