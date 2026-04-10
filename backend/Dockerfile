# Production Dockerfile optimized for Railway free tier
FROM node:20-alpine

# Install build deps for better-sqlite3
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files
COPY . .

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

# Use non-root user for security
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ping || exit 1

# Start application
CMD ["node", "server.js"]
