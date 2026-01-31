import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      API_KEY: 'test-api-key',
      JWT_SECRET: 'test-jwt-secret',
      GEMINI_API_KEY: 'test-gemini-key',
      NODE_ENV: 'test',
    },
  },
});
