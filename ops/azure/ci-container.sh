#!/usr/bin/env bash
# Install root-owned. Repository code runs only inside the disposable container.
set -Eeuo pipefail
mode="${1:?validate or build}"
source_dir="$(realpath "${2:?source directory}")"
reports="$(realpath "${3:?report directory}")"
run_id="${4:?run id}"
sha="${5:?commit}"
[[ "$mode" = validate || "$mode" = build ]] || exit 2
[[ "$run_id" =~ ^[0-9]+$ && "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "${LD_BASE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "${LD_SOCIAL:-false}" = true || "${LD_SOCIAL:-false}" = false ]] || exit 2
[[ "$source_dir" =~ ^/opt/azure-agent-ci/_work/[0-9]+/s$ ]] || exit 2
[[ "$reports" =~ ^/opt/azure-agent-ci/_work/[0-9]+/a$ ]] || exit 2
controller=/usr/local/lib/leaddrive-azure-ci
image="$(cat "$controller/image-id")"
postgres_image="$(cat "$controller/postgres-image-id")"
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
[[ "$postgres_image" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 2
test "$(git -C "$source_dir" rev-parse HEAD)" = "$sha"
if git -C "$source_dir" config --local --get-regexp '^(http\..*extraheader|credential\.helper)$' >/dev/null; then
  echo 'Checkout credential still present; refusing repository execution' >&2
  exit 1
fi
# One heavy phase for the whole host. No retry loop and no four competing heaps.
exec 9> /var/lock/leaddrive-azure-heavy.lock
flock -w 30 9 || { echo 'Another heavy phase holds the host lock'; exit 1; }
source "$controller/cleanup-resources.sh"
cleanup_idle_resources
available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
test "$available_kib" -ge 22020096 || { echo 'Less than 21 GiB available'; exit 1; }
name="ld-azure-${run_id}-$$"
cleanup() {
  docker rm -f "$name" "${name}-pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  docker volume rm "${name}-workspace" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# A fresh disk-backed workspace avoids Docker's writable overlay and keeps
# runtime-path fixtures outside /tmp. The trusted initializer sees no source,
# reports, agent home or credentials. Only this run can mount the volume.
docker volume create --label leaddrive.azure-ci=1 "${name}-workspace" >/dev/null
docker run --rm --network none --cap-drop=ALL --cap-add=CHOWN \
  --security-opt=no-new-privileges --user 0:0 \
  --mount "type=volume,src=${name}-workspace,dst=/workspace" \
  "$image" chown "$(id -u):$(id -g)" /workspace
docker network create --label leaddrive.azure-ci=1 "$name" >/dev/null
docker run -d --name "${name}-pg" --network "$name" --network-alias postgres \
  --label leaddrive.azure-ci=1 --label "leaddrive.azure-build=$run_id" \
  --memory=1g --memory-swap=1g --pids-limit=200 \
  -e POSTGRES_DB=event_platform_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  "$postgres_image" >/dev/null
for attempt in {1..30}; do
  if docker exec "${name}-pg" pg_isready -U postgres -d event_platform_test >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "${name}-pg" pg_isready -U postgres -d event_platform_test >/dev/null
set +e
timeout --signal=TERM --kill-after=30s 4500s docker run --name "$name" --network "container:${name}-pg" \
  --init --label leaddrive.azure-ci=1 --label "leaddrive.azure-build=$run_id" \
  --memory=18g --memory-swap=18g --cpus=6 --pids-limit=1500 --shm-size=512m \
  --cap-drop=ALL --security-opt=no-new-privileges --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$source_dir,dst=/source-ro,readonly" \
  --mount "type=volume,src=${name}-workspace,dst=/workspace" \
  --mount "type=bind,src=$reports,dst=/reports" \
  --mount "type=bind,src=$controller,dst=/controller,readonly" \
  -e HOME=/tmp/home -e CI=true -e DEPLOY_TARGET_SHA="$sha" \
  -e LD_BASE_SHA -e LD_SOCIAL \
  -e NEXT_PUBLIC_CARTO_BASEMAPS_API_KEY \
  "$image" bash -c 'mkdir -p "$HOME"; exec bash /controller/container-gates.sh "$1"' -- "$mode" 2>&1 \
  | sed -u 's/##vso\[/# #vso[/g; s/##\[/# #[/g'
status=${PIPESTATUS[0]}
set -e
cleanup
trap - EXIT
# Publishing must not follow a candidate-created link into the agent home.
if find "$reports" -type l -print -quit | grep -q .; then
  echo 'Artifact output contains a symbolic link; refusing publication' >&2
  exit 1
fi
if [ "$status" = 0 ] && [ "$mode" = build ]; then
  # Host-produced provenance; repository code cannot set pipeline logging commands
  # or select the source build consumed by the production job.
  printf '{"buildId":"%s","sha":"%s","image":"%s"}\n' "$run_id" "$sha" "$image" > "$reports/release-source.json"
  (cd "$reports" && sha256sum "leaddrive-prod-${sha}.tar.gz" server-deploy.sh release-source.json > SHA256SUMS)
fi
exit "$status"
