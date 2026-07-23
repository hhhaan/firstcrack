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
            // Dev sidecar already running — acceptable for e2e charge path
            console.warn('[e2e] port 9999 in use; reusing existing sidecar/mock');
            return;
        }
        throw err;
    }
}
