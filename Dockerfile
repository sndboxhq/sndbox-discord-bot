FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node assets/sndboxicon.png ./assets/sndboxicon.png
RUN mkdir -p /app/.data && chown -R node:node /app/.data

ENV NODE_ENV=production \
    STATE_FILE=/app/.data/state.json \
    BETA_STATE_FILE=/app/.data/beta.json \
    HONEYPOT_STATE_FILE=/app/.data/honeypot.json \
    HEALTH_FILE=/tmp/ready

VOLUME ["/app/.data"]
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('node:fs').accessSync(process.env.HEALTH_FILE)"]
CMD ["node", "src/index.js"]
