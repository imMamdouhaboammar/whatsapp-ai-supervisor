FROM node:22-bookworm-slim AS supervisor

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    TENANTS_FILE=/app/config/tenants.json

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config
RUN mkdir -p /app/data/audit /app/data/claims /app/data/browser /app/data/whatsapp-web

EXPOSE 3000
CMD ["node", "src/cli.js", "start"]

FROM node:24-bookworm-slim AS browser-worker

ARG AGENT_BROWSER_VERSION=0.34.0
ENV NODE_ENV=production

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config

RUN npm install -g "agent-browser@${AGENT_BROWSER_VERSION}" \
    && agent-browser install --with-deps \
    && rm -rf /root/.npm

ENV BROWSER_WORKER_HOST=0.0.0.0 \
    BROWSER_WORKER_PORT=7331 \
    BROWSER_WORKER_RUNTIME=agent-browser \
    BROWSER_ENGINE=chrome

EXPOSE 7331
CMD ["node", "src/cli.js", "browser-worker"]

FROM node:22-bookworm-slim AS whatsapp-web-worker

ENV NODE_ENV=production \
    TENANTS_FILE=/app/config/tenants.json \
    WHATSAPP_WEB_WORKER_HOST=0.0.0.0 \
    WHATSAPP_WEB_WORKER_PORT=7441 \
    WHATSAPP_WEB_DATA_DIR=/app/data/whatsapp-web \
    SUPERVISOR_INTERNAL_URL=http://supervisor:3000

WORKDIR /app/worker
COPY workers/whatsapp-web/package.json ./package.json
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev \
    && npx --no-install puppeteer browsers install chrome --install-deps \
    && npm cache clean --force
COPY workers/whatsapp-web/src ./src

WORKDIR /app
COPY config ./config
RUN mkdir -p /app/data/whatsapp-web/auth /app/data/whatsapp-web/spool \
    && chown -R node:node /app
USER node

EXPOSE 7441
CMD ["node", "worker/src/index.js"]
