#!/usr/bin/env bash
set -euo pipefail
archive="$RUNNER_TEMP/hostinger-5.0.0-linux-amd64.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/hostinger/api-cli/releases/download/v5.0.0/hostinger-5.0.0-linux-amd64.tar.gz -o "$archive"
echo "84499e0a354d3cc3773d7f98095e68b3d4270035756fef1407ca8cfbf94a42b1  $archive" | sha256sum --check --strict
mkdir -p "$RUNNER_TEMP/hostinger-bin"
tar -xzf "$archive" -C "$RUNNER_TEMP/hostinger-bin" hostinger
echo "$RUNNER_TEMP/hostinger-bin" >> "$GITHUB_PATH"
