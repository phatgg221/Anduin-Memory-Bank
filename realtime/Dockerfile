# syntax=docker/dockerfile:1
FROM oven/bun:1.3-debian AS bun

# Wrangler's local runtime (workerd) runs on Node; Bun is only the package manager.
FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 1999
ENV WRANGLER_SEND_METRICS=false
# Secrets come from the environment (docker-compose.yml); --var injects them into env.
CMD ["sh", "-c", "exec npx wrangler dev --ip 0.0.0.0 --port 1999 --show-interactive-dev-session=false --var JWT_SECRET:\"$JWT_SECRET\" --var REALTIME_SECRET:\"$REALTIME_SECRET\""]
