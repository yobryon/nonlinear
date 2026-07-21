# Build stage: install workspace deps, compile TypeScript, prune to prod.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests first so dependency layers cache well.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/storage-postgres/package.json packages/storage-postgres/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @nonlinear/api...

COPY packages/shared packages/shared
COPY packages/core packages/core
COPY packages/storage-postgres packages/storage-postgres
COPY apps/api apps/api
RUN pnpm --filter @nonlinear/shared build \
  && pnpm --filter @nonlinear/core build \
  && pnpm --filter @nonlinear/storage-postgres build \
  && pnpm --filter @nonlinear/api build \
  && pnpm --filter @nonlinear/api deploy --prod /out

# Runtime stage: small, non-root.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# The setup/use guides, exposed as MCP resources so connecting agents can read them.
COPY docs/guides ./guides
# Attachment blob volume mounts here; pre-create with the runtime user's ownership.
RUN mkdir -p /data/blobs && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
