# Stage 1: Build the Vite frontend and install all dependencies
FROM --platform=$BUILDPLATFORM node:24-slim AS builder

WORKDIR /app




# Install all dependencies (including devDependencies needed for Vite)
COPY package.json package-lock.json ./
COPY .husky ./.husky
RUN npm ci

# Copy the rest of the application
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY data ./data
COPY scripts ./scripts
COPY profiles ./profiles

# Run the build script
RUN npm run build

# Stage 2: Install production dependencies
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY .husky ./.husky
RUN npm ci --omit=dev

# Stage 3: Create the production image
FROM node:24-slim AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
# Ensure sqlite data, logs, and rules persist to the mounted volume
ENV WISHBOARD_DB_PATH=/app/data/wishboard.db
# Single-node deployment: enable SQLite WAL so reads don't block writes during
# submission bursts. Safe here (one process, local disk); the serverless target
# does not use this image and must never set this on the EFS-shared database.
ENV WISHBOARD_DB_WAL=1

# Copy node_modules from deps stage (has correctly built native bindings)
COPY --from=deps /app/node_modules ./node_modules

# Copy the built backend and frontend from the builder stage
COPY --from=builder /app/dist ./dist
# package.json is read at startup by src/cli/wishboard.js (`docker exec wishboard node src/cli/wishboard.js db ...`)
COPY package.json ./package.json
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/cli ./src/cli
COPY --from=builder /app/src/client/src/passphrase.js ./src/client/src/passphrase.js
COPY --from=builder /app/data ./data
COPY --from=builder /app/profiles ./profiles

# Fix permissions for the data directory so the node user can write to it
RUN chown -R node:node /app/data

# Copy entrypoint script and make it executable
COPY scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose the API port
EXPOSE 3000

# Mount the volume for persistence
VOLUME ["/app/data"]

# Define the entrypoint script (runs as root to fix permissions, then drops to node user)
ENTRYPOINT ["/app/entrypoint.sh"]

# Start the Express server
CMD ["node", "src/server/index.js"]
