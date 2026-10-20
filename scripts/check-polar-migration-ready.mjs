import { pathToFileURL } from 'node:url';

const ZERO = '00000000-0000-0000-0000-000000000000';
export const readinessProbes = [
    [
        'apply_polar_subscription_event',
        {
            p_org_id: ZERO,
            p_event_id: '',
            p_event_at: '2000-01-01T00:00:00Z',
            p_user_id: ZERO,
            p_customer_id: '',
            p_subscription: {},
            p_plan: null,
        },
    ],
    ['claim_polar_notification', { p_org_id: ZERO, p_event_id: '', p_payload: {} }],
    ['finish_polar_notification', { p_org_id: ZERO, p_event_id: '', p_lease_id: ZERO, p_sent: false }],
];
export async function checkMigrationReady({ url, anonKey, request = fetch }) {
    if (!url || !anonKey) throw new Error('Migration readiness configuration missing');
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new Error('Invalid readiness endpoint');
    if (!anonKey.startsWith('sb_publishable_')) {
        let role;
        try {
            role = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()).role;
        } catch {
            /* fail closed */
        }
        if (role !== 'anon') throw new Error('Readiness gate requires anonymous credentials');
    }
    for (const [name, payload] of readinessProbes) {
        let response;
        try {
            response = await request(`${endpoint.origin}/rest/v1/rpc/${name}`, {
                method: 'POST',
                headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000),
                redirect: 'error',
            });
        } catch {
            throw new Error(`${name}: readiness request failed`);
        }
        let body;
        try {
            body = await response.json();
        } catch {
            throw new Error(`${name}: unexpected readiness response`);
        }
        // Missing schema-cache function (PGRST202), successful anonymous execution,
        // generic auth rejection and any other response must block deployment.
        if (![401, 403].includes(response.status) || body?.code !== '42501') {
            throw new Error(`${name}: required RPC missing or anonymous privilege boundary not verified`);
        }
        console.log(`${name}: exists and anonymous execution denied`);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await checkMigrationReady({ url: process.env.SUPABASE_URL, anonKey: process.env.ANON_KEY });
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
