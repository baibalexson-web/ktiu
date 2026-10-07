FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production PUBLIC_MODE=1 AGATU_CACHE_DIR=/var/data/agatu
EXPOSE 10000
CMD ["node", "server.mjs"]
