FROM node:20-slim

WORKDIR /workspace/server

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm install

COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/scripts ./scripts
COPY server/src ./src
COPY docs ../docs

RUN mkdir -p runtime
RUN npm run prisma:generate
RUN npm run build

EXPOSE 8787

CMD ["sh", "-c", "npm run prisma:migrate && (npm run prisma:seed || true) && npm run start"]
