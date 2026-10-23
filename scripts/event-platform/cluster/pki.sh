#!/usr/bin/env bash
# Private CA for one Kafka cluster.
#
#   pki.sh init  DIR                 -> DIR/ca.key (0600), DIR/ca.pem
#   pki.sh issue DIR NAME SAN...     -> DIR/issued/NAME/{node.pem,ca.pem}
#
# NAME becomes the certificate CN and therefore the Kafka principal
# (render.mjs maps CN=<name> to User:<name>). SAN entries are DNS names or
# IPv4 addresses; hostname verification is on, so every address a peer dials
# must be listed. node.pem holds the unencrypted PKCS#8 key followed by the
# certificate, the layout Kafka's PEM keystore reads; it is written 0600 and
# must reach the host only over SSH. ca.key never leaves the operator's
# workstation.
set -Eeuo pipefail
umask 077

die() { printf 'pki: %s\n' "$*" >&2; exit 1; }

cmd="${1:-}"; dir="${2:-}"
[ -n "$dir" ] || die "usage: pki.sh init DIR | issue DIR NAME SAN..."

case "$cmd" in
  init)
    [ ! -e "$dir/ca.key" ] || die "$dir/ca.key exists; refusing to replace a CA"
    mkdir -p "$dir"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$dir/ca.key" 2>/dev/null
    openssl req -x509 -new -key "$dir/ca.key" -sha256 -days 3650 -subj "/CN=leaddrive-kafka-ca" \
      -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
      -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$dir/ca.pem"
    chmod 0644 "$dir/ca.pem"
    ;;
  issue)
    name="${3:-}"; shift 3 || true
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "certificate name must be a lowercase host/principal name"
    [ "$#" -gt 0 ] || die "at least one SAN is required"
    [ -f "$dir/ca.key" ] && [ -f "$dir/ca.pem" ] || die "no CA in $dir"
    sans=()
    for san in "$@"; do
      if [[ "$san" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then sans+=("IP:$san")
      elif [[ "$san" =~ ^[a-z0-9][a-z0-9.-]*$ ]]; then sans+=("DNS:$san")
      else die "bad SAN $san"; fi
    done
    out="$dir/issued/$name"
    [ ! -e "$out" ] || die "$out exists"
    mkdir -p "$out"
    work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$work/key.pem" 2>/dev/null
    openssl req -new -key "$work/key.pem" -subj "/CN=$name" -out "$work/req.csr"
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=%s\n' \
      "$(IFS=,; printf '%s' "${sans[*]}")" >"$work/ext.cnf"
    openssl x509 -req -in "$work/req.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca.key" -CAcreateserial \
      -days 825 -sha256 -extfile "$work/ext.cnf" -out "$work/cert.pem" 2>/dev/null
    openssl pkcs8 -topk8 -nocrypt -in "$work/key.pem" -out "$work/key8.pem"
    cat "$work/key8.pem" "$work/cert.pem" >"$out/node.pem"
    install -m 0644 "$dir/ca.pem" "$out/ca.pem"
    openssl verify -CAfile "$dir/ca.pem" "$work/cert.pem" >/dev/null
    ;;
  *) die "usage: pki.sh init DIR | issue DIR NAME SAN..." ;;
esac
