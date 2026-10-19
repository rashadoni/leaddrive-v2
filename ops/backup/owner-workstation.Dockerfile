# Multi-platform PostgreSQL 16.13 index (amd64 and ARM64).
FROM postgres:16.13-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50
RUN apk add --no-cache bash coreutils findutils util-linux tar grep sed nodejs openssh-client openssh-keygen curl ca-certificates \
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
ENTRYPOINT ["bash", "/usr/local/bin/owner-workstation"]
