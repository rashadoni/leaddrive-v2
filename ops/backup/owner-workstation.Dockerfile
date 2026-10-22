# Official multi-platform runtimes, amd64 and ARM64. Copy only the pinned
# Node binary (not Debian bookworm's older distribution Node package).
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS node-runtime
# Official multi-platform PostgreSQL16.15/glibc index.
FROM postgres:16.15-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4 AS vector-build
# pgvector v0.6.0, exact upstream commit and archive checksum. No native-CPU
# instructions or LLVM build dependency; build tooling never enters runtime.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl ca-certificates "postgresql-server-dev-16=$PG_VERSION" \
 && curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 120 \
      https://codeload.github.com/pgvector/pgvector/tar.gz/281d4fcf60e2f037fa09d62be2543bb4d7511f2b -o /tmp/vector.tar.gz \
 && printf '%s  /tmp/vector.tar.gz\n' e0728ec19cb9d75fcd5a329c48c070b942eb888e6cb83d9e50cc622f6b7d297a | sha256sum -c - \
 && mkdir /tmp/vector && tar -xzf /tmp/vector.tar.gz -C /tmp/vector --strip-components=1 \
 && make -C /tmp/vector -j2 PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config OPTFLAGS='' with_llvm=no \
 && make -C /tmp/vector install DESTDIR=/out PG_CONFIG=/usr/lib/postgresql/16/bin/pg_config OPTFLAGS='' with_llvm=no

FROM postgres:16.15-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=vector-build /out/usr/lib/postgresql/16/lib/vector.so /usr/lib/postgresql/16/lib/vector.so
COPY --from=vector-build /out/usr/share/postgresql/16/extension/vector* /usr/share/postgresql/16/extension/
# gawk, not bookworm's default mawk 1.3.4-20200120: that mawk has no interval
# expressions, so every `[0-9a-f]{64}` check in the verifiers silently never
# matched and the first real restore (2026-10-22) refused a valid archive.
RUN apt-get update && apt-get install -y --no-install-recommends bash coreutils findutils util-linux tar grep sed gawk openssh-client curl ca-certificates \
 && update-alternatives --set awk /usr/bin/gawk \
 && rm -rf /var/lib/apt/lists \
 && case "$(uname -m)" in \
      x86_64) arch=amd64; digest=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 ;; \
      aarch64) arch=arm64; digest=6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4 ;; \
      *) exit 1 ;; esac \
 && curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 120 \
      "https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-${arch}.tar.gz" -o /tmp/age.tar.gz \
 && printf '%s  /tmp/age.tar.gz\n' "$digest" | sha256sum -c - \
 && tar -xzf /tmp/age.tar.gz -C /tmp age/age age/age-keygen \
 && install -m 0755 /tmp/age/age /tmp/age/age-keygen /usr/local/bin/ \
 && rm -rf /tmp/age /tmp/age.tar.gz
COPY ops/backup/owner-workstation.sh /usr/local/bin/owner-workstation
COPY ops/backup/owner-workstation-template.mjs /usr/local/lib/leaddrive/owner-workstation-template.mjs
ENTRYPOINT ["bash", "/usr/local/bin/owner-workstation"]
