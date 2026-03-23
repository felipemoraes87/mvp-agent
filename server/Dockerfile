FROM node:20-slim

WORKDIR /workspace/server

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm install

COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/scripts ./scripts
COPY server/src ./src
COPY server/docker-entrypoint.sh /tmp/docker-entrypoint.sh
COPY docs ../docs

RUN mkdir -p runtime
RUN tr -d '\r' < /tmp/docker-entrypoint.sh > /workspace/server/docker-entrypoint.sh && rm /tmp/docker-entrypoint.sh
RUN npm run prisma:generate
RUN npm run build
RUN chmod +x /workspace/server/docker-entrypoint.sh
RUN chown -R node:node /workspace/server

USER node

EXPOSE 8787

CMD ["sh", "./docker-entrypoint.sh"]
