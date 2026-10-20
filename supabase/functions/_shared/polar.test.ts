import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkoutProduct, NEW_POLAR_ORG, OLD_POLAR_ORG, polarPlans, polarUser } from './polar.ts';
import { verifyPolarStandardSignature } from './polar-auth.ts';
import { verifyPolarSignature } from './webhook-auth.ts';

test('checkout accepts exactly six regional monthly keys; no arbitrary env reads', () => {
    for (const plan of ['PRO', 'PRO_PLUS'])
        for (const market of ['US', 'KR', 'JP']) {
            assert.equal(
                checkoutProduct(`POLAR_${plan}_PRODUCT_ID_${market}`, (key) => key),
                `POLAR_${plan}_PRODUCT_ID_${market}`,
            );
            assert.equal(
                checkoutProduct(`POLAR_${plan}_PRODUCT_ID_${market}_YEARLY`, () => 'unsafe'),
                undefined,
            );
        }
    for (const key of ['POLAR_PRO_PRODUCT_ID', 'POLAR_ENTERPRISE_PRODUCT_ID', 'SUPABASE_SERVICE_ROLE_KEY']) {
        assert.equal(
            checkoutProduct(key, () => 'unsafe'),
            undefined,
        );
    }
});
test('new and all twelve legacy regional mappings remain org-isolated', () => {
    const env = (key: string) => key;
    const old = polarPlans(env, OLD_POLAR_ORG);
    const next = polarPlans(env, NEW_POLAR_ORG);
    assert.equal(Object.keys(old).length, 15);
    assert.equal(Object.keys(next).length, 12);
    assert.equal(old.POLAR_LEGACY_PRO_PLUS_PRODUCT_ID_KR_YEARLY, 'pro_plus');
    assert.equal(old.POLAR_LEGACY_PRO_PRODUCT_ID, 'pro');
    assert.equal(next.POLAR_PRO_PRODUCT_ID_US, 'pro');
    assert.equal(next.POLAR_LEGACY_PRO_PRODUCT_ID_US, undefined);
    assert.equal(polarPlans(() => undefined, NEW_POLAR_ORG).unknown, undefined);
});
test('user identity never treats Polar customer id as auth user', () => {
    const user = '11111111-1111-4111-8111-111111111111';
    assert.equal(polarUser({ customer_id: user }), null);
    assert.equal(polarUser({ metadata: { user_id: user } }), user);
    assert.throws(() => polarUser({ customer: { external_id: user }, metadata: { user_id: 'different' } }));
});
test('legacy raw-body signature retained', async () => {
    assert.equal(
        await verifyPolarSignature(
            'secret',
            'body',
            'dc46983557fea127b43af721467eb9b3fde2338fe3e14f51952aa8478c13d355',
        ),
        true,
    );
    assert.equal(
        await verifyPolarSignature(
            'secret',
            'tampered',
            'dc46983557fea127b43af721467eb9b3fde2338fe3e14f51952aa8478c13d355',
        ),
        false,
    );
});
test('Standard Webhooks verifies raw bytes, key decoding, rotation list and timestamp', async () => {
    const secret = 'whsec_' + btoa('test-key');
    const timestamp = '1800000000';
    const body = '{"data": {}}';
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('test-key'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = Buffer.from(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`event.${timestamp}.${body}`)),
    ).toString('base64');
    const headers = new Headers({
        'webhook-id': 'event',
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,invalid v1,${sig}`,
    });
    assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000000000), true);
    assert.equal(await verifyPolarStandardSignature(secret, body + ' ', headers, 1800000000000), false);
    assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000301000), false);
    assert.equal(await verifyPolarStandardSignature('whsec_' + btoa('other'), body, headers, 1800000000000), false);
    assert.equal(await verifyPolarStandardSignature(secret, body, new Headers(), 1800000000000), false);
});
test('old-slot SDK UTF8 whsec key accepted only with explicit legacy flag', async () => {
    const secret = 'whsec_' + btoa('test-key');
    const timestamp = '1800000000';
    const body = '{"data":{}}';
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = Buffer.from(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`event.${timestamp}.${body}`)),
    ).toString('base64');
    const headers = new Headers({
        'webhook-id': 'event',
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${sig}`,
    });
    assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000000000, true), true);
    assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000000000), false);
    assert.equal(await verifyPolarStandardSignature(secret, body + ' ', headers, 1800000000000, true), false);
    assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000301000, true), false);
});

test('old common mappings prefer legacy aliases and retain original fallback', () => {
    const env = (key: string) =>
        (
            ({
                POLAR_LEGACY_PRO_PRODUCT_ID: 'old-pro',
                POLAR_PRO_PRODUCT_ID: 'replacement',
                POLAR_ENTERPRISE_PRODUCT_ID: 'fallback-enterprise',
            }) as Record<string, string>
        )[key];
    const plans = polarPlans(env, OLD_POLAR_ORG);
    assert.equal(plans['old-pro'], 'pro');
    assert.equal(plans.replacement, undefined);
    assert.equal(plans['fallback-enterprise'], 'enterprise');
    assert.equal(polarPlans(env, NEW_POLAR_ORG)['old-pro'], undefined);
});
test('historical polar_whs and URL-safe decoded keys are old-slot only', async () => {
    const bytes = new Uint8Array([251, 255, 239, 255]);
    const base64 = Buffer.from(bytes).toString('base64');
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const body = '{}';
    const timestamp = '1800000000';
    const signature = Buffer.from(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`event.${timestamp}.${body}`)),
    ).toString('base64');
    const headers = new Headers({
        'webhook-id': 'event',
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
    });
    for (const secret of [
        'polar_whs_' + base64,
        'whsec_' + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ]) {
        assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000000000, true), true);
        assert.equal(await verifyPolarStandardSignature(secret, body, headers, 1800000000000), false);
    }
});
