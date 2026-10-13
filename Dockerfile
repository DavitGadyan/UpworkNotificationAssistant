FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

# Web: Next standalone server on :3010
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3010 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/knowledge_base ./knowledge_base
EXPOSE 3010
CMD ["node", "server.js"]

# Worker: the poller, same source tree
FROM deps AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY . .
CMD ["npx", "tsx", "worker/index.ts"]
