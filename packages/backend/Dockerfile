FROM node:22-alpine

WORKDIR /app

# Copy workspace root files
COPY package.json yarn.lock* ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Install dependencies
RUN corepack enable && corepack prepare yarn@4.6.0 --activate
RUN yarn install

# Build shared package first
WORKDIR /app/packages/shared
RUN yarn build

# Build backend
WORKDIR /app/packages/backend
RUN yarn build

# Run migrations and start server
CMD ["sh", "-c", "yarn db:migrate && yarn start"]
