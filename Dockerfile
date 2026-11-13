# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so they are cached until the lock file changes.
# The postinstall step downloads the OCR language data into ./tessdata.
COPY package.json package-lock.json ./
COPY scripts/fetch-tessdata.mjs scripts/fetch-tessdata.mjs
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/package.json /app/next.config.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/tessdata ./tessdata

RUN mkdir -p /data && chown node:node /data /app/.next
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start"]
