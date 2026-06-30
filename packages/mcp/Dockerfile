# ----- Build Stage -----
FROM node:lts-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Copy monorepo config and install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/mcp ./packages/mcp
RUN pnpm install --frozen-lockfile

# Build the mcp package
RUN pnpm --filter @upstash/context7-mcp build

# ----- Production Stage -----
FROM node:lts-alpine
RUN corepack enable pnpm
WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/mcp/package.json ./packages/mcp/
RUN pnpm install --frozen-lockfile --prod --filter @upstash/context7-mcp

# Copy built files from builder
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

WORKDIR /app/packages/mcp
EXPOSE 8080
# Default to HTTP on :8080. Override args (e.g. `--transport stdio`) are appended to the entrypoint.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--transport", "http", "--port", "8080"]
