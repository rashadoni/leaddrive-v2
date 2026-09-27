#!/usr/bin/env bash
# Runs ON the production host, piped over ssh by
# .github/workflows/mtm-map-matching.yml. Puts a freshly built OSRM road graph
# of Azerbaijan behind 127.0.0.1:5055 (read by src/lib/mtm/map-matching.ts).
#
# Staged: the new graph must answer on a side port before it replaces the
# live one. The app never depends on it — while the container restarts, the
# history map simply keeps straight lines — so a failed switch leaves the old
# container running and fails the workflow loudly.
#
# Usage: bash -s -- <release-id> <osrm-image> < mtm-osrm-switch.sh
set -euo pipefail

release="${1:?release id required}"
image="${2:?osrm image required}"
case "$release" in *[!0-9a-zA-Z._-]*) echo "FATAL: bad release id"; exit 1 ;; esac
case "$image" in ghcr.io/project-osrm/osrm-backend:*) ;; *) echo "FATAL: unexpected image"; exit 1 ;; esac

root=/opt/mtm-osrm
incoming="$root/incoming"
dir="$root/releases/$release"
graph=/data/azerbaijan-latest.osrm
live_port=5055
next_port=5056

cd "$incoming"
sha256sum -c osrm-az.tgz.sha256
mkdir -p "$dir"
tar -xzf osrm-az.tgz -C "$dir"
rm -f osrm-az.tgz osrm-az.tgz.sha256
test -f "$dir/azerbaijan-latest.osrm.mldgr" || { echo "FATAL: graph files missing in $dir"; exit 1; }

docker pull --quiet "$image" >/dev/null

run_osrm() {
  local name="$1" port="$2" restart="$3"
  docker run -d --name "$name" --restart "$restart" \
    -p "127.0.0.1:${port}:5000" --memory 1500m \
    -v "$dir:/data:ro" "$image" \
    osrm-routed --algorithm mld --max-matching-size 500 "$graph" >/dev/null
}

answers() {
  local port="$1"
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/nearest/v1/driving/49.8671,40.4093" 2>/dev/null | grep -q '"code":"Ok"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

docker rm -f mtm-osrm-next >/dev/null 2>&1 || true
run_osrm mtm-osrm-next "$next_port" no
if ! answers "$next_port"; then
  docker logs --tail 40 mtm-osrm-next || true
  docker rm -f mtm-osrm-next >/dev/null 2>&1 || true
  echo "FATAL: the new graph did not answer; the live one is untouched"
  exit 1
fi
docker rm -f mtm-osrm-next >/dev/null

docker rm -f mtm-osrm >/dev/null 2>&1 || true
run_osrm mtm-osrm "$live_port" unless-stopped
answers "$live_port" || { docker logs --tail 40 mtm-osrm || true; echo "FATAL: live OSRM did not come up"; exit 1; }
ln -sfn "$dir" "$root/current"

# Keep the two newest graphs: the live one and the one before it.
find "$root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +3 | cut -d' ' -f2- | while read -r old; do
  case "$old" in "$root/releases/"*) rm -rf -- "$old" ;; esac
done

echo "mtm-osrm: release $release live on 127.0.0.1:${live_port}"
