# Single workspace image. docker-compose runs api/worker/web from it with different commands.
FROM node:20-bookworm-slim

# Prisma engines need openssl; tini for clean signal handling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Copy manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY packages/salesforce/package.json ./packages/salesforce/
COPY packages/mapping/package.json ./packages/mapping/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

RUN pnpm install

# Now the source.
COPY . .

# Generate the Prisma client into node_modules.
RUN pnpm --filter @opennpc/db run generate

EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
