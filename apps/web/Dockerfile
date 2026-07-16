# Build the SPA.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/storage-postgres/package.json packages/storage-postgres/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @nonlinear/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @nonlinear/shared build && pnpm --filter @nonlinear/web build

# Serve stage: nginx standing in for Azure Static Web Apps (static assets +
# /api proxied to the linked backend).
FROM nginx:1.27-alpine
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
