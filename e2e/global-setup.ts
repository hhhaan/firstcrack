import type { FullConfig } from '@playwright/test';
import { startSidecarMock } from './fixtures/sidecar-server';
import type http from 'node:http';

let server: http.Server | null = null;

export default async function globalSetup(_config: FullConfig) {
    try {
        server = await startSidecarMock(9999);
        // store for teardown
        (globalThis as { __E2E_SIDECAR__?: http.Server }).__E2E_SIDECAR__ = server;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
            throw new Error(
                '[e2e] port 9999 is already in use. Stop the dev sidecar (or any process on :9999) before running Playwright.',
            );
        }
        throw err;
    }
}
