# Shared image for the API, web app, demo site and test proxy (no browsers).
FROM node:22-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.28.0 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @js/database generate
# Next.js bakes rewrite destinations in at build time, so the API address is a build argument.
ARG BUILD_WEB=false
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN if [ "$BUILD_WEB" = "true" ]; then pnpm --filter @js/web build; fi
RUN mkdir -p /data/artifacts && chmod 777 /data/artifacts
USER node
