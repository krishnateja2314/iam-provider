FROM node:24.21.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY vitest.config.ts ./
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3100
# Migrations and the synthetic seed must be idempotent; never reset a database here.
CMD ["sh", "-ec", "npm run migrate && npm run seed && npm start"]
