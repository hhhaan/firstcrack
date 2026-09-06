import http from 'node:http';

const STATUS = {
    connected: true,
    // Not 'virtual' — prod Virtual Machine saves as is_practice and skips stock/History.
    // E2E roast-save-deduct must exercise the real save path.
    roaster: 'e2e',
    capabilities: ['heater', 'fan', 'drum'],
    error: null as string | null,
};

const TEMP = {
    bt: 185.2,
    et: 210.5,
    ror: 8.1,
    ror_et: 5.2,
    heater: 70,
    fan: 40,
    drum: 55,
    timestamp: Date.now() / 1000,
};

/**
 * Minimal sidecar HTTP mock so Active Roast can Charge without Tauri/Python.
 */
export function startSidecarMock(port = 9999): Promise<http.Server> {
    let tick = 0;
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = req.url ?? '/';
        const send = (code: number, body: unknown) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (url.startsWith('/status')) return send(200, STATUS);
        if (url.startsWith('/temperatures')) {
            TEMP.timestamp = Date.now() / 1000;
            TEMP.bt += ((tick++ % 10) / 10 - 0.4) * 0.5;
            return send(200, TEMP);
        }
        if (url.startsWith('/roasters')) return send(200, { roasters: [{ key: 'e2e', name: 'E2E' }] });
        if (url.startsWith('/serial-ports')) return send(200, []);
        if (url.startsWith('/connect') || url.startsWith('/disconnect') || url.startsWith('/standby') || url.startsWith('/start') || url.startsWith('/reset') || url.startsWith('/settings')) {
            return send(200, { ok: true, ...STATUS });
        }
        return send(404, { error: 'not found' });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}
