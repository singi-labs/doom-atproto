# Doom over AT Protocol -- Combined server + client image
#
# Runs both the Doom WASM engine (server) and the browser-facing
# client from a single container for simplicity.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/lexicons/package.json packages/lexicons/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/ packages/

# Build lexicons first (other packages depend on it)
RUN pnpm --filter @singi-labs/doom-lexicons build

# The server runs via tsx in dev mode (no build step needed for now)
# WASM files are pre-built and committed
EXPOSE 8666

# Default: run the local harness (Phase 1)
# Will be updated for the federated version
CMD ["pnpm", "--filter", "@singi-labs/doom-server", "dev:local"]
