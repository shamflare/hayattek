# Production image for the Next.js web app.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --frozen-lockfile --filter @hayat/web...
# Next.js bakes rewrites() into the build, so the API origin must be known here.
ARG HAYAT_API_ORIGIN=http://api:8000
ENV HAYAT_API_ORIGIN=$HAYAT_API_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @hayat/web build

FROM node:22-slim
RUN useradd --system --create-home --uid 10001 hayat
WORKDIR /repo
COPY --from=build --chown=hayat /repo ./
USER hayat
# Run Next directly: no package manager (and no download) needed at runtime.
WORKDIR /repo/apps/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HAYAT_API_ORIGIN=http://api:8000
EXPOSE 3100
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3100", "-H", "0.0.0.0"]
