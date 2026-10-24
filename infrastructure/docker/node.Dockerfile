# Shared image for the API, demo site and web app (TypeScript run via tsx; no browsers).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @js/database generate
ARG BUILD_WEB=false
RUN if [ "$BUILD_WEB" = "true" ]; then pnpm --filter @js/web build; fi
USER node
