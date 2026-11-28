import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Run Firefox only in CI to bypass local Windows sandbox environment startup issues
    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              launchOptions: {
                firefoxUserPrefs: {
                  'webgl.disabled': true,
                  'layers.acceleration.disabled': true,
                },
              },
            },
          },
        ]
      : []),
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3000',
      WISHBOARD_DB_PATH: 'data/e2e-test.db',
      WISHBOARD_ADMIN_SECRET: 'e2e-admin-password',
      NODE_ENV: 'test',
      ENABLE_AI_FEATURES: 'true',
      AI_PROVIDER: 'local',
      WISHBOARD_DB_WAL: '1',
    },
  },
});
