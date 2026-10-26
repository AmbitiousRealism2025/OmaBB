#!/bin/sh
case "$FAKE_PYTHON_MODE" in
  hang)
    exec sleep 30
    ;;
  echo)
    request=$3
    escaped=$(printf '%s' "$request" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"matched": true, "text": "%s", "nodes": 5, "truncated": false}\n' "$escaped"
    ;;
esac
