import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chooseFunctions, resolveFunctions } from './resolve-edge-functions.mjs';

const all = ['create-polar-checkout', 'polar-webhook', 'order-sync'];
test('exclusively Polar shared modules narrow deployment to both billing consumers', () => {
    for (const file of [
        'polar.ts',
        'polar-auth.ts',
        'polar.test.ts',
        'polar-notifications.ts',
        'polar-notifications.test.ts',
    ])
        assert.deepEqual(resolveFunctions([`supabase/functions/_shared/${file}`], all), [
            'create-polar-checkout',
            'polar-webhook',
        ]);
});
test('generic shared change always deploys all, including mixed changes', () => {
    for (const file of ['webhook-auth.ts', 'slack.ts', 'auth.ts', 'polar/submodule.ts'])
        assert.deepEqual(
            resolveFunctions(['supabase/functions/_shared/polar.ts', `supabase/functions/_shared/${file}`], all),
            [...all].sort(),
        );
});
test('direct consumers, unrelated functions, no changes, uncertainty and manual dispatch', () => {
    assert.deepEqual(resolveFunctions(['supabase/functions/order-sync/index.ts'], all), ['order-sync']);
    assert.deepEqual(
        resolveFunctions(['supabase/functions/_shared/polar-auth.ts', 'supabase/functions/order-sync/index.ts'], all),
        [...all].sort(),
    );
    assert.deepEqual(resolveFunctions([], all), []);
    assert.deepEqual(chooseFunctions({ event: 'push', paths: null, all }), [...all].sort());
    assert.deepEqual(chooseFunctions({ event: 'workflow_dispatch', paths: [], all }), [...all].sort());
    assert.deepEqual(chooseFunctions({ input: 'polar-webhook', paths: null, all }), ['polar-webhook']);
    assert.throws(() => chooseFunctions({ input: 'invalid', all }));
});
test('actual deploy job gates billing on tests and readiness before deployment', async () => {
    const { readFile } = await import('node:fs/promises');
    const workflow = await readFile(new URL('../.github/workflows/deploy-edge-functions.yml', import.meta.url), 'utf8');
    const deploy = workflow.indexOf('- name: Deploy functions');
    for (const gate of [
        '- name: Billing unit tests and deployment gate regressions',
        '- name: Billing PostgreSQL transaction tests',
        '- name: Billing public schema type regression',
        '- name: Require billing migration and anonymous RPC denial before deployment',
    ]) {
        assert.ok(workflow.indexOf(gate) > 0 && workflow.indexOf(gate) < deploy);
    }
    assert.ok(!workflow.includes('continue-on-error: true'));
    assert.ok(!workflow.includes('npm install'));
    assert.ok(workflow.includes('pnpm --dir'));
    assert.ok(workflow.includes('supabase/tests/polar-database-types.ts'));
    assert.ok(workflow.includes('pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413'));
    assert.ok(workflow.includes('run: node scripts/resolve-edge-functions.mjs'));
});
test('checkout error handling does not read or log upstream response body', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
        new URL('../supabase/functions/create-polar-checkout/index.ts', import.meta.url),
        'utf8',
    );
    assert.ok(!source.includes('checkoutRes.text('));
    assert.ok(!source.includes('polarBody'));
    assert.ok(!source.includes('errBody'));
});
