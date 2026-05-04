# Stage 1: build frontend SPA
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: backend runtime
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN rm -rf node_modules
RUN npm ci --only=production

COPY backend/src ./src

# Copy built frontend SPA from stage 1 into ./public (served by Express)
COPY --from=frontend-builder /frontend/dist ./public

RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/server.js"]
