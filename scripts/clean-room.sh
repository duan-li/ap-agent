#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
# Include pending review files. Leave local dependencies, databases and secrets behind.
export COPYFILE_DISABLE=1
git ls-files -co --exclude-standard -z | tar --null -T - -cf - |
  docker run --rm -i node:22 bash -euc '
    mkdir /review
    cd /review
    tar xf -
    sed -n "/^<!-- quickstart -->$/,/^<!-- end quickstart -->$/p" README.md |
      sed "1,2d;\$d" | sed "\$d" > /tmp/quickstart
    test -s /tmp/quickstart
    bash -eu -o pipefail /tmp/quickstart
  '
