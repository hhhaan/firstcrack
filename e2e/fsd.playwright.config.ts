import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.env.FSD_APP_REPO ?? root;
const port = Number(process.env.FSD_APP_PORT ?? 15420);
if (port === 9999) throw new Error('FSD verification refuses port 9999');

export default defineConfig({
    testDir: path.join(root, 'e2e/tests'),
    testMatch: 'fsd-mode.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    outputDir: process.env.FSD_OUTPUT ?? '/tmp/swarm-fsd03/app',
    reporter: [['list']],
    use: {
        actionTimeout: 15_000,
        baseURL: `http://127.0.0.1:${port}`,
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: { mode: 'on', size: { width: 1600, height: 1000 } },
    },
    // This project deliberately never invokes the shared port-9999 bootstrap.
    webServer: {
        command: `rtk pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: appRoot,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
            VITE_SUPABASE_URL: 'https://e2e.supabase.local',
            VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
            VITE_E2E: '1',
        },
    },
});
