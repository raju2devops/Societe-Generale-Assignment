

# --- Stage 1: dependencies ---------------------------------------------------
FROM node:22.13.1-alpine3.21 AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# --- Stage 2: runtime --------------------------------------------------------
FROM node:22.13.1-alpine3.21 AS runtime

# Patch the base image before anything else lands on it.
RUN apk upgrade --no-cache && \
    apk add --no-cache tini && \
    rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NODE_OPTIONS=--max-old-space-size=384

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# Read-only application tree owned by root, executed by an unprivileged user.
RUN chmod -R a-w /app/src /app/scripts

USER node

EXPOSE 4000

# tini reaps zombies and forwards SIGTERM so the graceful shutdown in
# server.js actually runs on `docker stop` rather than being killed mid-write.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=20s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
