# Browser worker: Playwright's official image already contains Chromium, Firefox and WebKit
# with their system dependencies. Keep the tag in sync with the playwright package version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @js/database generate
# Run as the unprivileged user shipped with the image.
USER pwuser
CMD ["pnpm", "--filter", "@js/worker", "start"]
