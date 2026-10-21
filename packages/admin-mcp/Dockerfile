# ----- Build Stage -----
FROM node:lts-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Copy monorepo config and install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/admin-mcp ./packages/admin-mcp
RUN pnpm install --frozen-lockfile --filter @upstash/context7-admin-mcp

# Build the admin-mcp package
RUN pnpm --filter @upstash/context7-admin-mcp build

# ----- Production Stage -----
FROM node:lts-alpine
RUN corepack enable pnpm
WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/admin-mcp/package.json ./packages/admin-mcp/
RUN pnpm install --frozen-lockfile --prod --filter @upstash/context7-admin-mcp

# Copy built files from builder
COPY --from=builder /app/packages/admin-mcp/dist ./packages/admin-mcp/dist

WORKDIR /app/packages/admin-mcp
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
