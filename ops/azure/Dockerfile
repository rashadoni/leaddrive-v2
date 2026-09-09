FROM node:20.20.2-bookworm-slim AS node20
FROM mcr.microsoft.com/playwright:v1.58.2-noble
COPY --from=node20 /usr/local/ /usr/local/
USER root
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client time python3 git ca-certificates curl && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=true NEXT_TELEMETRY_DISABLED=1
WORKDIR /source
