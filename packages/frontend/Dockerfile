FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy workspace root files
COPY package.json yarn.lock* ./
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

RUN corepack enable && corepack prepare yarn@4.6.0 --activate
RUN yarn install

# Build shared package
WORKDIR /app/packages/shared
RUN yarn build

# Build the frontend
FROM base AS builder
WORKDIR /app

COPY --from=deps /app ./

WORKDIR /app/packages/frontend
RUN yarn build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/packages/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/frontend/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
