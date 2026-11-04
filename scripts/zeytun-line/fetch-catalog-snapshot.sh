#!/usr/bin/env bash
# Copy the 1C catalog snapshot the phone line searches from prod, read-only,
# for the search and recognizer benchmarks (search-benchmark.ts,
# recognizer-benchmark.ts).
#
#   bash scripts/zeytun-line/fetch-catalog-snapshot.sh <out-dir>
#
# Which snapshot: the line grant's approvedSource (the line takes the newest
# live snapshot of that scope, zeytun-inbound-host.ts loadCatalog). On prod it
# only reads the grant and the snapshot; nothing is written there. The copy is
# the client's catalog: put it in a session temp directory, never in Git.
set -euo pipefail

out="${1:?usage: fetch-catalog-snapshot.sh <out-dir>}"
key="${LEADDRIVE_PROD_SSH_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}"
host="${LEADDRIVE_PROD_HOST:-root@13.140.132.245}"

case "$(cd "$(dirname "$out")" 2>/dev/null && pwd -P)/" in
  "$(git rev-parse --show-toplevel 2>/dev/null || echo /nonexistent)"/*)
    echo "refusing to write the client's catalog inside the repository: $out" >&2; exit 2 ;;
esac

mkdir -p "$out"
chmod 700 "$out"
umask 077
target="$out/catalog.snapshot"

# shellcheck disable=SC2016 # expanded on prod
ssh -o BatchMode=yes -i "$key" "$host" '
  set -euo pipefail
  dir=$(sed -n "s/^ZEYTUN_CACHE_DIR=//p" /etc/leaddrive/app.env | head -1)
  scope=$(python3 -c "import json;print(json.load(open(\"/var/lib/leaddrive-v2/zeytun-voice-pilot/inbound-grant.json\"))[\"approvedSource\"][\"scopeKey\"])")
  case "$scope" in *[!0-9a-f]*|"") echo "bad scope key" >&2; exit 3 ;; esac
  cat "$dir/$scope.snapshot"
' > "$target.tmp"
mv "$target.tmp" "$target"
head -1 "$target" | cut -c1-240
echo "saved $(wc -c < "$target") bytes to $target"
