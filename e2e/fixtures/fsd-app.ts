import { test as base, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedAuthSession } from './auth';
import { E2E_USER } from './constants';
import { MockDb } from './mock-db';
import { installMockSupabase } from './mock-supabase';
import { tauriInitScript } from './tauri-stub';

type Reference = {
    source_session_id: string;
    points: { elapsed_sec: number; acquired_at: number; sensor_clock: string; bt_c: number; processing: unknown }[];
};
type Launch = { sidecar: string; token: string; fixture: string; fixture_token: string; reference: Reference; pid: number };
export type FsdFixture = {
    page: Page;
    db: MockDb;
    reference: Reference;
    state: () => Promise<any>;
    inject: (action: string) => Promise<void>;
    traffic: { path: string; method: string; body: unknown; status: number; at: number; ack: number }[];
    errors: string[];
    unmatched: string[];
    delayMs: number;
    delayReceipts: boolean;
    profiles: Record<string, unknown>[];
};

const tsv = (reference: Reference) =>
    'time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock\textra_readings\n' +
    `# processing\t${JSON.stringify(reference.points[0].processing)}\n` +
    reference.points.map(p => [p.elapsed_sec, p.bt_c, '', '', '', 0, 0, '', '', p.bt_c, '', p.acquired_at, p.sensor_clock, ''].join('\t') + '\n').join('');

export const test = base.extend<{ fsd: FsdFixture }>({
    fsd: async ({ page, baseURL }, use, info) => {
        if (!baseURL || new URL(baseURL).port === '9999') throw new Error('owned app origin required');
        const root = process.cwd();
        await mkdir(info.outputDir, { recursive: true });
        const child = spawn('rtk', ['proxy', path.join(root, 'src-tauri/sidecar/.venv/bin/python'), '-u',
            path.join(root, 'e2e/fixtures/fsd-sidecar.py'), '--repo', root, '--output', info.outputPath('sidecar.json')],
            { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        const launched = await new Promise<Launch>((resolve, reject) => {
            const lines = createInterface({ input: child.stdout });
            const timer = setTimeout(() => reject(new Error(`virtual fixture startup timeout: ${stderr}`)), 15_000);
            lines.on('line', line => {
                if (!line.startsWith('{"sidecar"')) return;
                clearTimeout(timer);
                resolve(JSON.parse(line));
                lines.close();
            });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${stderr}`)); });
        });
        if ([launched.sidecar, launched.fixture].some(url => new URL(url).port === '9999')) throw new Error('reserved port');
        const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
        const db = new MockDb();
        db.seedBean({ name: 'FSD fixture lot', stockGrams: 10_000 });
        const profiles = [
            { id: 'fsd-recorded', user_id: E2E_USER.id, name: 'Recorded thermal reference', source_session_id: launched.reference.source_session_id,
                duration_sec: 180, drop_temp_celsius: 170, machine_id: 'fsd-live', default_bean: null, default_blend: null,
                source_session: { tsv_path: 'fixture-reference.tsv', events: [
                    { id: 'reference-charge', type: 'Charge', time_sec: 0 }, { id: 'reference-drop', type: 'Drop', time_sec: 180 }],
                    machine_id: 'fsd-live', machine_roaster_key: 'virtual', machine_protocol: 'virtual', machine_name: 'Isolated thermal virtual' } },
            { id: 'fsd-synthetic', user_id: E2E_USER.id, name: 'Synthetic reference', source_session_id: null,
                duration_sec: 180, drop_temp_celsius: 170, source_session: null, default_bean: null, default_blend: null },
        ];
        const recorded = profiles[0];
        profiles.push(
            { ...recorded, id: 'fsd-legacy', name: 'Legacy reference', source_session: { ...recorded.source_session, tsv_path: null } },
            { ...recorded, id: 'fsd-missing', name: 'Missing download', source_session: { ...recorded.source_session, tsv_path: 'missing.tsv' } },
            { ...recorded, id: 'fsd-mismatch', name: 'Other machine reference', source_session: { ...recorded.source_session, machine_id: 'other-virtual' } },
        );
        db.tsvFiles.set('fixture-reference.tsv', tsv(launched.reference));
        const fsd: FsdFixture = { page, db, reference: launched.reference, profiles, traffic: [], errors: [], unmatched: [],
            delayMs: 0, delayReceipts: false,
            state: async () => (await fetch(launched.fixture + '/state', { headers: { 'X-Fixture-Token': launched.fixture_token } })).json(),
            inject: async action => { const response = await fetch(launched.fixture + '/inject', {
                method: 'POST', headers: { 'X-Fixture-Token': launched.fixture_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
                expect(response.status).toBe(200); },
        };
        await page.addInitScript(tauriInitScript);
        await page.addInitScript(({ token }) => {
            const w = window as any;
            const original = w.__TAURI_INTERNALS__.invoke;
            const files: Record<string, string> = {};
            const settings: Record<string, unknown> = { 'roast.settings': { pollIntervalMs: 500, autoChargeEnabled: false, autoDropEnabled: false, bbpEnabled: false } };
            const timers = new Map<number, ReturnType<typeof setInterval>>();
            let eventId = 0;
            w.__FSD_FILES__ = files;
            w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
            w.__TAURI_INTERNALS__.invoke = async (command: string, args: any, options: any) => {
                if (command === 'sidecar_token') return token;
                if (command === 'plugin:dialog|message' && args.buttons?.OkCancelCustom) {
                    return args.buttons.OkCancelCustom[window.confirm(args.message) ? 0 : 1];
                }
                if (command === 'plugin:store|load' || command === 'plugin:store|get_store') return 1;
                if (command === 'plugin:store|get') return [settings[args.key], args.key in settings];
                if (command === 'plugin:store|set') { settings[args.key] = args.value; return; }
                if (command === 'plugin:fs|write_text_file') {
                    const file = decodeURIComponent(options.headers.path);
                    const append = JSON.parse(options.headers.options).append;
                    files[file] = (append ? files[file] ?? '' : '') + new TextDecoder().decode(args);
                    return;
                }
                if (command === 'plugin:fs|read_text_file') {
                    if (!(args.path in files)) throw new Error('file not found (os error 2)');
                    return Array.from(new TextEncoder().encode(files[args.path]));
                }
                if (command === 'plugin:fs|exists') return args.path in files;
                if (command === 'plugin:fs|remove') { delete files[args.path]; return; }
                if (command === 'plugin:event|listen') {
                    const id = ++eventId;
                    if (args.event === 'sidecar-poll-tick') timers.set(id, setInterval(() => w['_' + args.handler]?.({ event: args.event, id, payload: null }), 500));
                    return id;
                }
                if (command === 'plugin:event|unlisten') { clearInterval(timers.get(args.eventId)); timers.delete(args.eventId); return; }
                return original(command, args, options);
            };
        }, { token: launched.token });
        await seedAuthSession(page);
        await page.route('**/*', async route => {
            if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
            fsd.unmatched.push(route.request().url());
            return route.abort();
        });
        await page.routeWebSocket('**/*', socket => socket.close());
        await installMockSupabase(page, db);
        const otherOwner = '22222222-2222-4222-8222-222222222222';
        const otherOrg = '33333333-3333-4333-8333-333333333333';
        await page.route('**/rest/v1/profiles?**', route => {
            const params = new URL(route.request().url()).searchParams;
            return route.fulfill({ json: params.get('id')?.startsWith('in.')
                ? [{ id: otherOwner, plan: 'pro_plus', business_name: 'Other virtual workspace' }]
                : { id: E2E_USER.id, plan: 'pro_plus', simulator_enabled: true, business_name: 'Local virtual verification' } });
        });
        await page.route('**/rest/v1/organization_members?**', route => route.fulfill({ json: [{ org_id: otherOrg, role: 'admin' }] }));
        await page.route('**/rest/v1/organizations?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('owner_id') ? [] : [{ id: otherOrg, owner_id: otherOwner, name: 'Other virtual workspace' }] }));
        await page.route('**/rest/v1/roast_profiles?**', route => route.fulfill({ json: profiles }));
        await page.route('**/functions/v1/get-upload-url', route => {
            const body = route.request().postDataJSON();
            return route.fulfill({ json: { url: `https://e2e.r2.local/profiles/${E2E_USER.id}/${body.sessionId}${body.kind === 'bbp' ? '.bbp' : ''}.tsv` } });
        });
        await page.route('**/e2e.r2.local/**', async route => {
            if (route.request().method() !== 'PUT') return route.fallback();
            const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
            db.tsvFiles.set(key, route.request().postData() ?? '');
            return route.fulfill({ status: 200, body: '' });
        });
        await page.route('http://127.0.0.1:9999/**', async route => {
            const request = route.request(), url = new URL(request.url());
            const at = performance.now();
            if (fsd.delayMs) await new Promise(resolve => setTimeout(resolve, fsd.delayMs));
            if (fsd.delayReceipts && url.pathname === '/pid/receipts') await new Promise(resolve => setTimeout(resolve, 3000));
            const response = await route.fetch({ url: launched.sidecar + url.pathname + url.search,
                headers: { ...request.headers(), 'X-Sidecar-Token': launched.token } });
            fsd.traffic.push({ path: url.pathname + url.search, method: request.method(), body: request.postDataJSON(), status: response.status(), at, ack: performance.now() });
            await route.fulfill({ response });
        });
        // Match the production JSONB CAS semantics used for late receipt append.
        await page.route('**/rest/v1/roast_sessions?**', async route => {
            const params = new URL(route.request().url()).searchParams;
            if (route.request().method() === 'GET' && params.get('id')?.startsWith('eq.')) {
                const row = db.sessions.find(s => s.id === params.get('id')?.slice(3));
                const single = route.request().headers().accept?.includes('application/vnd.pgrst.object');
                return route.fulfill({ json: single ? row ?? null : row ? [row] : [] });
            }
            if (route.request().method() !== 'PATCH' || !params.has('events')) return route.fallback();
            const row = db.sessions.find(s => s.id === params.get('id')?.slice(3) && s.user_id === params.get('user_id')?.slice(3));
            const filter = params.get('events');
            const same = (a: unknown, b: unknown): boolean => {
                if (a === b) return true;
                if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
                const left = Object.keys(a), right = Object.keys(b);
                return left.length === right.length && left.every(k => right.includes(k) && same((a as any)[k], (b as any)[k]));
            };
            const matches = row && (filter === 'is.null' ? row.events == null : same(row.events, JSON.parse(filter!.slice(3))));
            if (matches) Object.assign(row, route.request().postDataJSON());
            return route.fulfill({ json: matches ? [{ id: row.id }] : [] });
        });
        page.on('pageerror', error => fsd.errors.push(String(error)));
        try {
            await page.goto('/');
            await expect(page.getByTestId('app-sidebar')).toBeVisible({ timeout: 30_000 });
            await use(fsd);
        } finally {
            await writeFile(info.outputPath('browser-evidence.json'), JSON.stringify({ traffic: fsd.traffic, errors: fsd.errors, unmatched: fsd.unmatched, sessions: db.sessions, files: Object.fromEntries(db.tsvFiles) }, null, 2));
            const cleanupUrl = `${baseURL}/__fsd_cleanup.html`;
            await page.route(cleanupUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture cleanup</title>' }), { times: 1 });
            await page.goto(cleanupUrl);
            await page.unrouteAll({ behavior: 'wait' });
            await page.close();
            child.stdin.end('\n');
            const code = await Promise.race([exit, new Promise(resolve => setTimeout(() => resolve('timeout'), 10_000))]);
            if (code === 'timeout') child.kill('SIGTERM');
            await writeFile(info.outputPath('sidecar-stderr.log'), stderr);
            expect(code, 'owned virtual sidecar cleanup').toBe(0);
            expect(fsd.unmatched, 'unmatched network traffic').toEqual([]);
            expect(fsd.errors, 'uncaught app errors').toEqual([]);
        }
    },
});

export { expect };
