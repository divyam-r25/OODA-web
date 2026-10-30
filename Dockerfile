# ── Build Stage ──
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies needed for build
COPY package.json package-lock.json ./
RUN npm ci

# Copy application sources
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY shared/ ./shared/
COPY server/ ./server/
COPY web/ ./web/

# Build server bundle (dist/server) and web app (dist/web)
RUN npm run build

# ── Production Runtime ──
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/app/data/ooda.sqlite
ENV STATIC_DIR=/app/dist/web

# Create data directory for SQLite
RUN mkdir -p /app/data

# Copy compiled bundles from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/api/health || exit 1

# Start production server
CMD ["node", "dist/server/index.js"]
