# =============================================================================
# SPA image - built with Node, served by nginx-unprivileged on port 8080.
# =============================================================================

# --- Stage 1: build ----------------------------------------------------------
FROM node:22.13.1-alpine3.21 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
# Optional: point at the official brand asset at build time.
ARG VITE_BRAND_LOGO_URL=""
ENV VITE_BRAND_LOGO_URL=$VITE_BRAND_LOGO_URL
RUN npm run build

# --- Stage 2: serve ----------------------------------------------------------
# nginx-unprivileged runs as uid 101 and listens on 8080 - no root, no
# capability to bind a privileged port.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

USER 101

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
