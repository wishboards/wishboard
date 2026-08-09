/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(projectRoot, 'src/client');
const packageJson = JSON.parse(fs.readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'));

const defaultRepo = 'https://github.com/wishboards/wishboard';
const pkgRepo = packageJson.repository?.url 
  ? packageJson.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
  : defaultRepo;
const githubRepo = process.env.GITHUB_REPOSITORY 
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : pkgRepo;

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_GITHUB_REPO': JSON.stringify(githubRepo),
  },
  // Vite should bundle the client app from src/client
  root: clientRoot,
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    // Use repo root for testing so both client and server files are visible.
    root: projectRoot,
    globals: true,
    environment: 'jsdom',
    environmentMatchGlobs: [
      ['**/src/server/**', 'node'],
      ['**/src/cli/**', 'node'],
      ['**/scripts/**', 'node'],
      ['**/aws-serverless/**', 'node'],
    ],
    include: [
      'src/client/src/**/*.{test,spec}.{ts,tsx}',
      'src/server/**/*.{test,spec}.{js,ts}',
      'src/cli/**/*.{test,spec}.{js,ts}',
      'scripts/**/*.{test,spec}.{js,ts}',
      'aws-serverless/**/*.{test,spec}.{js,mjs,ts}',
      'tests/integration/**/*.integration.test.js',
    ],
    setupFiles: 'tests/setupTests.ts',
    globalSetup: 'vitest.global-setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.d.ts'],
      include: [
        'src/client/src/**/*.{js,ts,tsx}',
        'src/server/**/*.{js,ts}',
        'src/cli/**/*.{js,ts}',
        'scripts/**/*.{js,ts}',
        'aws-serverless/**/*.{js,mjs,ts}',
      ],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vitest test option extension onto Vite UserConfig requires fallback cast
  } as any,
});
