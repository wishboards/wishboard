#!/usr/bin/env bash
# Runs on every container start, not just on create.
#
# Guards against /tmp arriving non-writable. It should be 1777 (world-writable,
# sticky) and is in the base image, but some runtime and host combinations
# present it as 755 root:root instead. When that happens nothing running as the
# non-root `node` user can write there, which breaks npm, vitest, Playwright and
# any tool that allocates a temp directory — usually with an opaque EACCES a
# long way from the cause.
set -uo pipefail

if [[ -w /tmp ]]; then
  exit 0
fi

echo "[post-start] /tmp is not writable (currently $(stat -c '%a %U:%G' /tmp)); restoring 1777"
if sudo chmod 1777 /tmp 2>/dev/null; then
  echo "[post-start] /tmp is now $(stat -c '%a %U:%G' /tmp)"
else
  echo "[post-start] could not repair /tmp; tools that write there will fail" >&2
fi
