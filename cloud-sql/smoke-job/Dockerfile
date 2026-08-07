# HRRR-Smoke ingestion job. ecCodes supplies grib_get (nearest-gridpoint
# extraction) — wgrib2 is not packaged in Debian bookworm.
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libeccodes-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
