# Doom over AT Protocol -- Multi-stage build
#
# Builds both the game server and the player client.

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

# Build lexicons (other packages depend on it)
RUN pnpm --filter @singi-labs/doom-lexicons build

EXPOSE 8666 8667
