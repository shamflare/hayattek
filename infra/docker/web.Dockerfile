# Production image for the Next.js web app.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm install --frozen-lockfile --filter @hayat/web...
RUN pnpm --filter @hayat/web build

FROM node:22-slim
RUN corepack enable && useradd --system --uid 10001 hayat
WORKDIR /repo
COPY --from=build --chown=hayat /repo ./
USER hayat
ENV NODE_ENV=production HAYAT_API_ORIGIN=http://api:8000
EXPOSE 3100
CMD ["pnpm", "--filter", "@hayat/web", "start"]
