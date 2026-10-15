# syntax=docker/dockerfile:1
FROM oven/bun:1.3-debian AS bun

# PartyKit's dev server (workerd) runs on Node; Bun is only the package manager.
FROM node:22-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 1999
# Secrets come from the environment (docker-compose.yml); --var injects them into room.env.
CMD ["sh", "-c", "exec npx partykit dev --port 1999 --no-hotkeys --var JWT_SECRET=\"$JWT_SECRET\" --var REALTIME_SECRET=\"$REALTIME_SECRET\""]
