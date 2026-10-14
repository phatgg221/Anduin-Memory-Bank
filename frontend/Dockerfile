# syntax=docker/dockerfile:1
FROM oven/bun:1.3-debian AS bun

# Next.js runs on Node (Cache Components requires the Node.js runtime); Bun is only the package manager.
FROM node:22-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Development: source bind-mounted by docker-compose, node_modules/.next kept in anonymous volumes.
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

FROM deps AS build
COPY . .
# Rewrites are resolved at build time: the backend URL must be known here.
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
RUN bun run build

# Production: standalone server output only.
FROM node:22-bookworm-slim AS prod
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
