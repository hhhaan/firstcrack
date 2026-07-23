import type http from 'node:http';

export default async function globalTeardown() {
    const server = (globalThis as { __E2E_SIDECAR__?: http.Server }).__E2E_SIDECAR__;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
