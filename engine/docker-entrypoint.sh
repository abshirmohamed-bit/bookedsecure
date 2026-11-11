#!/bin/sh
# Fly mounts volumes as root. Create what the Engine needs, hand it to the
# unprivileged user, then exec so the server becomes PID 1, gets SIGTERM
# directly, and its exit code reaches Fly unchanged (idle shutdown needs 0).
set -e

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR" "$DATA_DIR/media" "${HF_HOME:-$DATA_DIR/models}"
chown -R engine:engine "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  exec gosu engine "$@"
fi
exec "$@"
