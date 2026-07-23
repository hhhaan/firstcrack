import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 1420);

export default defineConfig({
    testDir: path.join(root, 'e2e', 'tests'),
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(root, 'e2e-report') }]],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
        ...devices['Desktop Chrome'],
    },
    webServer: {
        command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
        cwd: root,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            ...process.env,
            VITE_SUPABASE_URL: 'https://e2e.supabase.local',
            VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
            VITE_E2E: '1',
        },
    },
    globalSetup: path.join(root, 'e2e', 'global-setup.ts'),
    globalTeardown: path.join(root, 'e2e', 'global-teardown.ts'),
});
