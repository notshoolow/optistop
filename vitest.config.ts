import { defineConfig } from 'vitest/config';
import path from 'path';

// RNF-06.1: la suite debe pasar en cualquier zona horaria del servidor.
// Por defecto UTC (como Vercel/CI); en CI también se ejecuta con TEST_TZ=Pacific/Auckland.
process.env.TZ = process.env.TEST_TZ ?? 'UTC';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
