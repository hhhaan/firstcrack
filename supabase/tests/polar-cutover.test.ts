// Isolated PostgreSQL WASM test. Full Supabase migration replay still needs Docker.
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.POLAR_PGLITE_MODULE ?? 'npm:@electric-sql/pglite@0.3.14');

import { strict as assert } from 'node:assert';

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE profiles(id uuid PRIMARY KEY,plan text,polar_customer_id text);
CREATE TABLE subscriptions(id uuid DEFAULT gen_random_uuid(),user_id uuid,polar_subscription_id text UNIQUE,
status text CHECK(status IN ('active','trialing','incomplete','incomplete_expired','past_due','canceled','unpaid')),trial_end timestamptz,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,
ends_at timestamptz,polar_product_id text,amount integer,currency text,recurring_interval text,updated_at timestamptz);
INSERT INTO profiles VALUES('11111111-1111-4111-8111-111111111111','trial',null);`);
await db.exec(await readFile(new URL('../migrations/20261020000000_polar_org_cutover.sql', import.meta.url), 'utf8'));
const old = 'f0ef6666-e89c-4a50-8808-78ff4b4d3a1d',
    next = '3b6494cb-8248-47d1-a5f2-65ff7ca9b8a8';
const user = '11111111-1111-4111-8111-111111111111';
async function event(
    org: string,
    id: string,
    time: string,
    sub: string,
    status: string,
    plan: string | null = 'pro',
    end = '2099-01-01T00:00:00Z',
) {
    const result = await db.query('SELECT apply_polar_subscription_event($1,$2,$3,$4,$5,$6,$7) AS result', [
        org,
        id,
        time,
        user,
        org,
        { id: sub, status, current_period_end: end },
        plan,
    ]);
    return result.rows[0].result;
}
async function plan() {
    return (await db.query('SELECT plan FROM profiles')).rows[0].plan;
}
assert.equal(await event(old, '1', '2026-10-20T10:00:00Z', 'old', 'active'), 'applied');
assert.equal(await plan(), 'pro');
assert.equal(await event(old, '1', '2026-10-20T10:00:00Z', 'old', 'active'), 'duplicate');
assert.equal(await event(old, '0', '2026-10-20T09:00:00Z', 'old', 'revoked'), 'stale');
assert.equal(await event(next, '2', '2026-10-20T11:00:00Z', 'new', 'active', 'pro_plus'), 'applied');
assert.equal(await event(old, '3', '2026-10-20T12:00:00Z', 'old', 'revoked'), 'applied');
assert.equal(await plan(), 'pro_plus');
assert.equal(await event(next, '4', '2026-10-20T12:00:00Z', 'new', 'canceled', 'pro_plus'), 'applied');
assert.equal(await plan(), 'pro_plus');
assert.equal(await event(next, '5', '2026-10-20T13:00:00Z', 'new', 'revoked', 'pro_plus'), 'applied');
assert.equal(await plan(), 'read_only');
assert.equal(
    (await db.query("SELECT status FROM subscriptions WHERE polar_subscription_id='new'")).rows[0].status,
    'canceled',
);
assert.equal(await event(next, '6', '2026-10-20T13:00:00Z', 'new', 'active', 'pro_plus'), 'stale');
assert.equal(await plan(), 'read_only');
assert.equal(await event(next, '7', '2026-10-20T14:00:00Z', 'unknown', 'active', null), 'applied');
assert.equal(await plan(), 'read_only');
const before = (await db.query('SELECT count(*) FROM polar_webhook_events')).rows[0].count;
await assert.rejects(() =>
    db.query('SELECT apply_polar_subscription_event($1,$2,$3,$4,$5,$6,$7)', [
        next,
        'rollback',
        '2026-10-20T15:00:00Z',
        user,
        'different',
        { id: 'x', status: 'active' },
        'pro',
    ]),
);
assert.equal((await db.query('SELECT count(*) FROM polar_webhook_events')).rows[0].count, before);
assert.equal((await db.query('SELECT count(*) FROM billing_customers')).rows[0].count, 2);
// biome-ignore lint/suspicious/noConsole: standalone SQL test success output for CI.
console.log(
    'PASS: SQL migration, duplicate/stale/order, cancellation grace, cross-org revocation, unknown product, mapping rollback',
);
for (const manual of ['tester', 'team', 'trial']) {
    await db.query('UPDATE profiles SET plan=$1', [manual]);
    await event(next, 'manual-' + manual, '2026-10-21T14:00:00Z', 'manual-' + manual, 'incomplete', 'pro');
    assert.equal(await plan(), manual);
}
// biome-ignore lint/suspicious/noConsole: standalone SQL test success output for CI.
console.log('PASS: tester/team/trial unaffected by non-entitling billing event');
async function claim(id = 'order.paid:order1', payload = { text: 'canonical' }) {
    return (await db.query('SELECT claim_polar_notification($1,$2,$3) AS value', [next, id, payload])).rows[0]
        .value as { status: string; lease_id: string; payload: { text: string } };
}
async function finish(lease: string, sent: boolean, id = 'order.paid:order1') {
    return (await db.query('SELECT finish_polar_notification($1,$2,$3,$4) AS value', [next, id, lease, sent])).rows[0]
        .value;
}
const claims = await Promise.all([claim(), claim()]);
assert.deepEqual(claims.map((x) => x.status).sort(), ['busy', 'claimed']);
const first = claims.find((x) => x.status === 'claimed')!;
assert.equal(await finish('00000000-0000-0000-0000-000000000000', true), false);
assert.equal(await finish(first.lease_id, false), true);
const retry = await claim(undefined, { text: 'different endpoint' });
assert.equal(retry.status, 'claimed');
assert.equal(retry.payload.text, 'canonical');
await db.exec("UPDATE polar_notification_outbox SET lease_until=now()-interval '1 second'");
const recovered = await claim();
assert.equal(recovered.status, 'claimed');
assert.notEqual(recovered.lease_id, retry.lease_id);
assert.equal(await finish(retry.lease_id, true), false);
assert.equal(await finish(recovered.lease_id, true), true);
assert.equal((await claim()).status, 'sent');
assert.equal(await finish(recovered.lease_id, false), false);
for (const role of ['anon', 'authenticated']) {
    assert.equal(
        (
            await db.query(
                "SELECT has_function_privilege($1,'claim_polar_notification(uuid,text,jsonb)','EXECUTE') AS allowed",
                [role],
            )
        ).rows[0].allowed,
        false,
    );
    assert.equal(
        (await db.query("SELECT has_table_privilege($1,'polar_notification_outbox','SELECT') AS allowed", [role]))
            .rows[0].allowed,
        false,
    );
}
assert.equal(
    (
        await db.query(
            "SELECT has_function_privilege('service_role','claim_polar_notification(uuid,text,jsonb)','EXECUTE') AS allowed",
        )
    ).rows[0].allowed,
    true,
);
// biome-ignore lint/suspicious/noConsole: standalone SQL test success output for CI.
console.log(
    'PASS: outbox simultaneous claim contention, failure retry, expiry takeover, stale-finisher fencing, canonical payload, sent dedupe, service-only ACL',
);
await db.close();
