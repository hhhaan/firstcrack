/** Local disposable PostgreSQL fixture only. Never accepts a remote DB URL. */
import postgres from 'npm:postgres@3.4.9';
import { digest, pkce } from '../functions/_shared/mcp-oauth/crypto.ts';
import { issuerStore, readGateway } from '../functions/_shared/mcp-oauth/postgres.ts';
import { IssuerService, type JsonRecord } from '../functions/_shared/mcp-oauth/service.ts';
import { runWriteHttpChecks } from './mcp-inventory-http.ts';

const port = Deno.args[0];
if (!port || !/^\d{4,5}$/.test(port)) throw new Error('Expected a disposable local fixture port');
const admin = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 4, onnotice: () => {} });
const app = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 2, onnotice: () => {} });
const store = issuerStore(`postgres://mcp_issuer_test@127.0.0.1:${port}/postgres`);
const gateway = readGateway(`postgres://mcp_gateway_test@127.0.0.1:${port}/postgres`);
const issuer = 'https://identity.example/oauth/mcp';
const resource = 'https://resource.example/mcp';
const member = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const outsider = '44444444-4444-4444-8444-444444444444';
const bean = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignBean = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const legacyBean = crypto.randomUUID();
const identity = { userId: member, workspaces: [{ owner_id: owner, name: 'Roastery' }] };
const service = new IssuerService(
    { issuer, resource, consentUrl: 'https://identity.example/oauth/consent', allowedOrigins: [], writeEnabled: true },
    store,
);
let checks = 0;
function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
    checks++;
}
function equal(actual: unknown, expected: unknown, message: string): void {
    check(
        JSON.stringify(actual) === JSON.stringify(expected),
        `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
async function actualFunction(file: string, name: string) {
    const source = await Deno.readTextFile(new URL(`../migrations/${file}`, import.meta.url));
    const match = new RegExp(
        `CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\([\\s\\S]*?\\n(?:\\$\\$|\\$function\\$);`,
        'i',
    ).exec(source);
    if (!match) throw new Error(`Missing actual RPC ${name} in ${file}`);
    await admin.unsafe(match[0]);
}
async function connect(write = true) {
    const verifier = 'a'.repeat(64);
    const params = new URLSearchParams({
        client_id: 'fixture-client',
        redirect_uri: 'https://host.example/callback',
        response_type: 'code',
        scope: write ? 'firstcrack:read firstcrack:write' : 'firstcrack:read',
        state: crypto.randomUUID(),
        code_challenge: await pkce(verifier),
        code_challenge_method: 'S256',
        resource,
    });
    const consent = new URL(await service.authorize(params));
    const authorization = consent.searchParams.get('authorization_id') ?? '';
    const details = await service.details(authorization, identity);
    equal(details.scope, params.get('scope'), 'stored requested consent scope');
    const decision = await service.decide(authorization, 'approve', owner, identity, write);
    const code = new URL(decision.redirect_url).searchParams.get('code') ?? '';
    const token = await service.token(
        new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: 'fixture-client',
            redirect_uri: 'https://host.example/callback',
            code,
            code_verifier: verifier,
            resource,
        }),
    );
    equal(token.scope, params.get('scope'), 'stored grant scope returned');
    return { hash: await digest(token.access_token), token };
}
const args = <T extends JsonRecord>(extra: T) => ({
    request_id: crypto.randomUUID(),
    reason: 'isolated fixture',
    ...extra,
});
const write = (hash: string, tool: string, input: JsonRecord) => gateway.write(hash, issuer, resource, tool, input);
async function balance(table: string, source: string, column: string) {
    const [row] = await admin.unsafe(
        `select coalesce(sum(${column}),0)::integer as amount from public.${table} where ${table === 'product_stock_events' ? 'product_id' : 'bean_id'}=$1 and user_id=$2`,
        [source, owner],
    );
    return row.amount;
}
async function native<T>(run: (sql: postgres.TransactionSql) => Promise<T>) {
    return app.begin(async (sql) => {
        await sql`set local role authenticated`;
        await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: member, role: 'authenticated' })}, true), set_config('request.jwt.claim.sub', ${member}, true)`;
        return run(sql);
    });
}
try {
    await actualFunction('20260727000001_fix_roast_deduction_blocked_batch.sql', 'roast_deduction_blocked');
    await actualFunction('20261020071807_roast_profile_sources_and_session_blend.sql', 'upsert_roasted_inbound');
    await actualFunction('20261029143000_total_batch_mark_compact.sql', 'save_roast_op');
    await actualFunction('20260802000000_fix_stock_guard_corrective_inbound.sql', 'insert_packaging_op');
    await actualFunction('20260802000000_fix_stock_guard_corrective_inbound.sql', 'fulfill_order');
    await admin.unsafe('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated');
    await admin`insert into beans(id,user_id,name) values(${legacyBean},${owner},'legacy negative fixture')`;
    await admin`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${legacyBean},-5,'adjustment')`;
    await admin.unsafe(
        await Deno.readTextFile(
            new URL('../migrations/20261101051354_mcp_inventory_production_write.sql', import.meta.url),
        ),
    );

    const rw = await connect();
    const ro = await connect(false);
    await service
        .token(
            new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: 'fixture-client',
                refresh_token: ro.token.refresh_token,
                resource,
                scope: 'firstcrack:read firstcrack:write',
            }),
        )
        .then(
            () => {
                throw new Error('Read refresh expanded scope');
            },
            (error) => {
                equal(error.code, 'invalid_scope', 'read refresh cannot add write scope');
            },
        );
    const rotatedRead = await service.token(
        new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'fixture-client',
            refresh_token: ro.token.refresh_token,
            resource,
        }),
    );
    equal(rotatedRead.scope, 'firstcrack:read', 'failed expansion did not burn read refresh');
    const pendingWrite = new URL(
        await service.authorize(
            new URLSearchParams({
                client_id: 'fixture-client',
                redirect_uri: 'https://host.example/callback',
                response_type: 'code',
                scope: 'firstcrack:read firstcrack:write',
                state: 'read-only-checkbox',
                code_challenge: await pkce('b'.repeat(64)),
                code_challenge_method: 'S256',
                resource,
            }),
        ),
    );
    const pendingWriteId = pendingWrite.searchParams.get('authorization_id') ?? '';
    const unchecked = await service.decide(pendingWriteId, 'approve', owner, identity);
    const uncheckedToken = await service.token(
        new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: 'fixture-client',
            redirect_uri: 'https://host.example/callback',
            code: new URL(unchecked.redirect_url).searchParams.get('code') ?? '',
            code_verifier: 'b'.repeat(64),
            resource,
        }),
    );
    equal(uncheckedToken.scope, 'firstcrack:read', 'unchecked write checkbox reduces grant to read');
    const foreignIdentity = { userId: outsider, workspaces: [{ owner_id: owner, name: 'untrusted assertion' }] };
    const pendingForeign = new URL(
        await service.authorize(
            new URLSearchParams({
                client_id: 'fixture-client',
                redirect_uri: 'https://host.example/callback',
                response_type: 'code',
                scope: 'firstcrack:read firstcrack:write',
                state: 'foreign',
                code_challenge: await pkce('c'.repeat(64)),
                code_challenge_method: 'S256',
                resource,
            }),
        ),
    );
    await service
        .decide(pendingForeign.searchParams.get('authorization_id') ?? '', 'approve', owner, foreignIdentity, true)
        .then(
            () => {
                throw new Error('Foreign consent granted');
            },
            (error) => {
                equal(error.code, 'access_denied', 'DB independently rejects unauthorized owner during consent');
            },
        );
    const [privileges] =
        await admin`select has_table_privilege('mcp_gateway_test','public.bean_stock_events','INSERT') as gateway_insert, has_table_privilege('mcp_issuer_test','public.bean_stock_events','INSERT') as issuer_insert, pg_has_role('mcp_gateway_test','firstcrack_mcp_writer','MEMBER') as writer_member, (select rolbypassrls from pg_roles where rolname='firstcrack_mcp_writer') as bypass`;
    equal(privileges.gateway_insert, false, 'gateway has no table writes');
    equal(privileges.issuer_insert, false, 'issuer has no table writes');
    equal(privileges.writer_member, false, 'gateway cannot assume writer');
    equal(privileges.bypass, false, 'writer does not bypass RLS');
    const [authUsage] = await admin`select has_schema_privilege('firstcrack_mcp_writer','auth','USAGE') as allowed`;
    equal(authUsage.allowed, false, 'writer does not inherit managed Auth privileges');
    for (const actor of [
        { subject: member, claims: '', expected: member },
        { subject: '', claims: JSON.stringify({ sub: owner }), expected: owner },
        { subject: member, claims: JSON.stringify({ sub: owner }), expected: member },
        { subject: '', claims: '', expected: null },
        { subject: member, claims: 'invalid-json', expected: member },
    ]) {
        await admin.begin(async (sql) => {
            await sql`select set_config('request.jwt.claim.sub',${actor.subject},true), set_config('request.jwt.claims',${actor.claims},true)`;
            await sql`set local role authenticated`;
            const [nativeActor] = await sql`select auth.uid() as original, public.request_user_id() as actor`;
            equal(nativeActor.actor, actor.expected, 'native actor lookup matches verified claim semantics');
            equal(nativeActor.actor, nativeActor.original, 'native actor lookup preserves auth.uid result');
            await sql`set local role firstcrack_mcp_writer`;
            const [writerActor] = await sql`select public.request_user_id() as actor`;
            equal(writerActor.actor, actor.expected, 'restricted writer resolves actor without auth schema');
        });
    }
    for (const role of ['authenticated', 'firstcrack_mcp_writer']) {
        await admin
            .begin(async (sql) => {
                await sql`select set_config('request.jwt.claim.sub','invalid-uuid',true), set_config('request.jwt.claims','',true)`;
                await sql.unsafe(`set local role ${role}`);
                await sql`select public.request_user_id()`;
            })
            .then(
                () => {
                    throw new Error('Malformed actor UUID accepted');
                },
                (error: unknown) => {
                    if (!(error instanceof postgres.PostgresError)) throw error;
                    equal(error.code, '22P02', 'malformed actor remains an invalid UUID');
                },
            );
    }
    const receiptArgs = args({ bean_id: bean, quantity_g: 1000, unit_cost_per_kg: 20.5 });
    equal(
        (await write(ro.hash, 'receive_green_stock', receiptArgs)).error,
        'insufficient_scope',
        'read token cannot write',
    );
    equal(
        (await write('0'.repeat(64), 'receive_green_stock', receiptArgs)).error,
        'invalid_token',
        'unknown token cannot write',
    );
    equal(
        (await gateway.write(rw.hash, 'https://wrong.example', resource, 'receive_green_stock', receiptArgs)).error,
        'invalid_token',
        'issuer binding',
    );
    equal(
        (await gateway.write(rw.hash, issuer, 'https://wrong.example/mcp', 'receive_green_stock', receiptArgs)).error,
        'invalid_token',
        'resource binding',
    );
    const initialGreen = await balance('bean_stock_events', bean, 'delta_grams');
    check((await write(rw.hash, 'receive_green_stock', receiptArgs)).result, 'receive green');
    equal(
        await balance('bean_stock_events', bean, 'delta_grams'),
        initialGreen + 1000,
        'receiving increments green only once',
    );
    check((await write(rw.hash, 'receive_green_stock', receiptArgs)).result, 'same request retries safely');
    equal(await balance('bean_stock_events', bean, 'delta_grams'), initialGreen + 1000, 'retry does not increment');
    equal(
        (await write(rw.hash, 'receive_green_stock', { ...receiptArgs, quantity_g: 1001 })).error,
        'idempotency_conflict',
        'request reuse with changed arguments',
    );
    const [event] =
        await admin`select cost_per_kg::text, created_by, note from bean_stock_events where reference_id=${receiptArgs.request_id}`;
    equal(event.created_by, member, 'audit actor is native user');
    equal(event.cost_per_kg, '20.5', 'purchase price per kg preserved');
    equal(event.note, receiptArgs.reason, 'audit reason preserved');

    for (const [tool, input] of [
        ['adjust_green_stock', args({ bean_id: bean, delta_g: -100 })],
        ['adjust_roasted_stock', args({ bean_id: bean, delta_g: 100 })],
        ['adjust_product_stock', args({ product_id: bean, delta: 2 })],
    ] as const)
        check((await write(rw.hash, tool, input)).result, tool);
    const production = crypto.randomUUID();
    const roastArgs = args({
        production_id: production,
        bean_id: bean,
        input_weight_g: 1000,
        output_weight_g: 850,
        roasted_at: '2026-11-01T09:00:00Z',
    });
    check((await write(rw.hash, 'record_roast_production', roastArgs)).result, 'record roast production');
    const [roast] =
        await admin`select bean_id, created_by, weight_grams, output_weight_grams from roast_sessions where id=${production}`;
    equal(roast.bean_id, bean, 'actual app roast RPC writes bean');
    equal(roast.created_by, member, 'actual app roast RPC writes actor');
    equal(roast.weight_grams, 1000, 'roast input grams');
    equal(roast.output_weight_grams, 850, 'roast output grams');
    const afterRoast = await balance('bean_stock_events', bean, 'delta_grams');
    const retryRoast = await write(rw.hash, 'record_roast_production', {
        ...roastArgs,
        request_id: crypto.randomUUID(),
    });
    equal(retryRoast.error, 'production_exists', 'same production/new request is refused');
    equal(
        await balance('bean_stock_events', bean, 'delta_grams'),
        afterRoast,
        'new request cannot duplicate production',
    );
    const packId = crypto.randomUUID();
    const packageArgs = args({
        production_id: packId,
        product_id: bean,
        quantity: 2,
        packaged_at: '2026-11-01T10:00:00Z',
    });
    const beforePack = await balance('roasted_stock_events', bean, 'delta_grams');
    const beforeProducts = await balance('product_stock_events', bean, 'delta_units');
    check((await write(rw.hash, 'record_packaging_production', packageArgs)).result, 'record packaging');
    equal(
        await balance('roasted_stock_events', bean, 'delta_grams'),
        beforePack - 400,
        'packaging consumes product specification grams',
    );
    equal(await balance('product_stock_events', bean, 'delta_units'), beforeProducts + 2, 'packaging produces units');
    const packagedRows =
        await admin`select created_at from product_stock_events where reference_id=${packId} union all select created_at from roasted_stock_events where reference_id=${packId}`;
    equal(packagedRows.length, 2, 'packaging stores both ledger legs');
    for (const packagedRow of packagedRows)
        equal(
            packagedRow.created_at.toISOString(),
            '2026-11-01T10:00:00.000Z',
            'packaged_at applies to both ledger timestamps',
        );
    check((await write(rw.hash, 'record_packaging_production', packageArgs)).result, 'packaging retry');
    equal(
        await balance('product_stock_events', bean, 'delta_units'),
        beforeProducts + 2,
        'packaging retry no second inbound',
    );

    const failedProduction = crypto.randomUUID();
    equal(
        (
            await write(rw.hash, 'record_roast_production', {
                ...roastArgs,
                request_id: crypto.randomUUID(),
                production_id: failedProduction,
                input_weight_g: 100000,
            })
        ).error,
        'insufficient_stock',
        'insufficient green rejects production',
    );
    const [{ n: failedSessions }] =
        await admin`select count(*)::integer as n from roast_sessions where id=${failedProduction}`;
    equal(failedSessions, 0, 'insufficient green rolls back session');
    const [{ n: failedEvents }] =
        await admin`select count(*)::integer as n from roasted_stock_events where reference_id=${failedProduction}`;
    equal(failedEvents, 0, 'insufficient green rolls back roasted inbound');
    const failedPackage = crypto.randomUUID();
    equal(
        (
            await write(rw.hash, 'record_packaging_production', {
                ...packageArgs,
                request_id: crypto.randomUUID(),
                production_id: failedPackage,
                quantity: 1000,
            })
        ).error,
        'insufficient_stock',
        'insufficient roasted rejects packaging',
    );
    const [{ n: failedUnits }] =
        await admin`select count(*)::integer as n from product_stock_events where reference_id=${failedPackage}`;
    equal(failedUnits, 0, 'packaging rolls back product inbound');
    const foreignProductionId = crypto.randomUUID();
    await admin`insert into roasted_stock_events(user_id,bean_id,delta_grams,event_type)
      values('33333333-3333-4333-8333-333333333333',${foreignBean},100,'adjustment')`;
    await admin`insert into roasted_stock_events(user_id,bean_id,delta_grams,event_type,reference_id)
      values('33333333-3333-4333-8333-333333333333',${foreignBean},-1,'packaging',${foreignProductionId})`;
    const unitsBeforeForeignProduction = await balance('product_stock_events', bean, 'delta_units');
    const gramsBeforeForeignProduction = await balance('roasted_stock_events', bean, 'delta_grams');
    equal(
        (
            await write(
                rw.hash,
                'record_packaging_production',
                args({
                    production_id: foreignProductionId,
                    product_id: bean,
                    quantity: 1,
                    packaged_at: '2026-11-01T10:00:00Z',
                }),
            )
        ).error,
        'production_exists',
        'another workspace production ID cannot create one-sided packaging',
    );
    equal(
        await balance('product_stock_events', bean, 'delta_units'),
        unitsBeforeForeignProduction,
        'foreign production ID rolls back product inbound',
    );
    equal(
        await balance('roasted_stock_events', bean, 'delta_grams'),
        gramsBeforeForeignProduction,
        'foreign production ID preserves bulk stock',
    );
    const foreignSourceProduct = crypto.randomUUID();
    await admin`insert into products(id,user_id,name,net_weight_grams,is_active,bean_id) values(${foreignSourceProduct},${owner},'foreign linked product',200,true,${foreignBean})`;
    const badPackageId = crypto.randomUUID();
    equal(
        (
            await write(rw.hash, 'record_packaging_production', {
                ...packageArgs,
                request_id: crypto.randomUUID(),
                production_id: badPackageId,
                product_id: foreignSourceProduct,
            })
        ).error,
        'invalid_arguments',
        'foreign bulk reference cannot produce one-sided packaging',
    );
    const [{ n: badPackageLegs }] =
        await admin`select (select count(*) from product_stock_events where reference_id=${badPackageId})::integer + (select count(*) from roasted_stock_events where reference_id=${badPackageId})::integer as n`;
    equal(badPackageLegs, 0, 'foreign bulk failure rolls back both ledgers');
    const appPackageId = crypto.randomUUID();
    const nativeProductEvents = [
        { user_id: owner, product_id: bean, delta_units: 1, event_type: 'roast_inbound', reference_id: appPackageId },
    ];
    const nativeRoastedEvents = [
        { user_id: owner, bean_id: bean, delta_grams: -200, event_type: 'packaging', reference_id: appPackageId },
    ];
    await native(async (sql) => {
        await sql`select insert_packaging_op(${sql.json(nativeProductEvents)}::jsonb,${sql.json(nativeRoastedEvents)}::jsonb)`;
    });
    const afterAppPackage = await balance('product_stock_events', bean, 'delta_units');
    await native(async (sql) => {
        await sql`select insert_packaging_op(${sql.json(nativeProductEvents)}::jsonb,${sql.json(nativeRoastedEvents)}::jsonb)`;
    });
    equal(
        await balance('product_stock_events', bean, 'delta_units'),
        afterAppPackage,
        'existing app packaging retries remain idempotent',
    );
    equal(
        (
            await write(rw.hash, 'record_packaging_production', {
                ...packageArgs,
                production_id: appPackageId,
                request_id: crypto.randomUUID(),
                quantity: 1,
            })
        ).error,
        'production_exists',
        'app packaging production ID cannot be registered by MCP',
    );
    await native(async (sql) => {
        await sql`delete from product_stock_events where reference_id=${appPackageId}`;
        await sql`delete from roasted_stock_events where reference_id=${appPackageId}`;
    });
    equal(
        (
            await write(rw.hash, 'record_packaging_production', {
                ...packageArgs,
                production_id: appPackageId,
                request_id: crypto.randomUUID(),
                quantity: 1,
            })
        ).error,
        'production_exists',
        'deleting both native packaging legs does not release production ID',
    );

    for (const input of [
        args({ bean_id: foreignBean, quantity_g: 100 }),
        args({ bean_id: crypto.randomUUID(), quantity_g: 100 }),
    ])
        equal(
            (await write(rw.hash, 'receive_green_stock', input)).error,
            'access_denied',
            'foreign/missing reference denied',
        );
    equal(
        (
            await write(rw.hash, 'record_roast_production', {
                ...roastArgs,
                request_id: crypto.randomUUID(),
                production_id: crypto.randomUUID(),
                bean_id: foreignBean,
            })
        ).error,
        'access_denied',
        'foreign roast reference denied without one-sided leg',
    );
    for (const change of [
        { quantity_g: 0 },
        { quantity_g: -1 },
        { quantity_g: 0.5 },
        { quantity_g: '1' },
        { quantity_g: 1e9 + 1 },
        { reason: '' },
        { request_id: 'bad' },
        { request_id: '123456781234123412341234567890ab' },
        { bean_id: 123 },
        { bean_id: 'bad' },
        { user_id: owner },
        { workspace_owner_id: owner },
        { unit_cost_per_kg: -1 },
    ])
        equal(
            (
                await write(rw.hash, 'receive_green_stock', {
                    ...receiptArgs,
                    request_id: crypto.randomUUID(),
                    ...change,
                })
            ).error,
            'invalid_arguments',
            `strict SQL boundary ${JSON.stringify(change)}`,
        );

    await admin`update profiles set plan='pro' where id=${owner}`;
    equal(
        (await write(rw.hash, 'receive_green_stock', args({ bean_id: bean, quantity_g: 1 }))).error,
        'insufficient_plan',
        'plan checked on each write',
    );
    await admin`update profiles set plan='pro_plus' where id=${owner}`;
    await admin`delete from organization_members where org_id=${bean} and user_id=${member}`;
    equal(
        (await write(rw.hash, 'receive_green_stock', args({ bean_id: bean, quantity_g: 1 }))).error,
        'invalid_token',
        'removed membership stops writes',
    );
    await admin`insert into organization_members values(${bean},${member})`;

    await admin`delete from roast_sessions where id=${production}`;
    equal(
        (await write(rw.hash, 'record_roast_production', { ...roastArgs, request_id: crypto.randomUUID() })).error,
        'production_exists',
        'deleted source still reserves production ID',
    );
    equal(
        await balance('bean_stock_events', bean, 'delta_grams'),
        afterRoast,
        'deleting source and changing request cannot deduct again',
    );
    const appProduction = crypto.randomUUID();
    await native(async (sql) => {
        await sql`select save_roast_op(${sql.json({ id: appProduction, user_id: owner, bean_id: bean, weight_grams: 100, output_weight_grams: 85, status: 'completed' })}::jsonb,true,100,85,false)`;
    });
    await admin`delete from roast_sessions where id=${appProduction}`;
    equal(
        (
            await write(rw.hash, 'record_roast_production', {
                ...roastArgs,
                request_id: crypto.randomUUID(),
                production_id: appProduction,
            })
        ).error,
        'production_exists',
        'deleted native app production ID remains reserved',
    );

    async function denied(run: (sql: postgres.TransactionSql) => Promise<unknown>, message: string, code = '23514') {
        let found = false;
        try {
            await native(run);
        } catch (error) {
            if (error instanceof postgres.PostgresError && error.code === code) found = true;
            else throw error;
        }
        check(found, message);
    }
    const beforeLedgerEdit = await balance('bean_stock_events', bean, 'delta_grams');
    await denied(async (sql) => {
        await sql`update bean_stock_events set delta_grams=-10000,event_type='adjustment' where reference_id=${receiptArgs.request_id}`;
    }, 'app UPDATE cannot make ledger negative');
    await denied(async (sql) => {
        await sql`delete from bean_stock_events where id=${bean}`;
    }, 'app DELETE cannot remove consumed inbound');
    await denied(async (sql) => {
        await sql`update bean_stock_events set bean_id=${foreignBean} where reference_id=${receiptArgs.request_id}`;
    }, 'app UPDATE cannot move a ledger leg to foreign source');
    equal(await balance('bean_stock_events', bean, 'delta_grams'), beforeLedgerEdit, 'all failed edits roll back');
    await native(async (sql) => {
        await sql`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${legacyBean},3,'adjustment')`;
    });
    equal(
        await balance('bean_stock_events', legacyBean, 'delta_grams'),
        -2,
        'corrective positive inbound remains allowed for legacy negative stock',
    );
    await denied(async (sql) => {
        await sql`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${legacyBean},-1,'adjustment')`;
    }, 'further legacy negative debit refused');
    await native(async (sql) => {
        await sql`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${legacyBean},-100,'adjustment'),(${owner},${legacyBean},105,'adjustment')`;
    });
    equal(
        await balance('bean_stock_events', legacyBean, 'delta_grams'),
        3,
        'multirow statement guards net effect, preserving corrective batches',
    );

    const expectedBean = crypto.randomUUID();
    await admin`insert into beans(id,user_id,name) values(${expectedBean},${owner},'expected inbound fixture')`;
    await admin`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${expectedBean},10000,'expected_inbound')`;
    equal(
        (await write(rw.hash, 'adjust_green_stock', args({ bean_id: expectedBean, delta_g: -1 }))).error,
        'insufficient_stock',
        'expected inbound is not spendable green inventory',
    );
    const expectedPurchaseId = crypto.randomUUID();
    await admin`insert into bean_stock_events(id,user_id,bean_id,delta_grams,event_type) values(${expectedPurchaseId},${owner},${expectedBean},100,'purchase')`;
    check(
        (await write(rw.hash, 'adjust_green_stock', args({ bean_id: expectedBean, delta_g: -90 }))).result,
        'received inventory can be consumed beside expected inbound',
    );
    await denied(async (sql) => {
        await sql`update bean_stock_events set event_type='expected_inbound' where id=${expectedPurchaseId}`;
    }, 'reclassifying consumed receiving as planned inbound is a debit');
    const [{ event_type: preservedType }] =
        await admin`select event_type from bean_stock_events where id=${expectedPurchaseId}`;
    equal(preservedType, 'purchase', 'failed reclassification preserves actual receiving');

    const raceBean = crypto.randomUUID();
    await admin`insert into beans(id,user_id,name) values(${raceBean},${owner},'race fixture')`;
    await admin`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${raceBean},1000,'purchase')`;
    const appSaved = Promise.withResolvers<void>();
    const releaseApp = Promise.withResolvers<void>();
    const appTransaction = native(async (sql) => {
        await sql`select save_roast_op(${sql.json({ id: crypto.randomUUID(), user_id: owner, bean_id: raceBean, weight_grams: 700, output_weight_grams: 595, status: 'completed' })}::jsonb,true,700,595,false)`;
        appSaved.resolve();
        await releaseApp.promise;
    });
    const raceArgs = args({
        production_id: crypto.randomUUID(),
        bean_id: raceBean,
        input_weight_g: 700,
        output_weight_g: 595,
        roasted_at: '2026-11-01T09:00:00Z',
    });
    try {
        await Promise.race([
            appSaved.promise,
            appTransaction.then(() => {
                throw new Error('App transaction unexpectedly ended');
            }),
        ]);
        equal(
            (await write(rw.hash, 'record_roast_production', raceArgs)).error,
            'inventory_busy',
            'MCP cannot race uncommitted app debit',
        );
    } finally {
        releaseApp.resolve();
        await appTransaction;
    }
    equal(
        (await write(rw.hash, 'record_roast_production', raceArgs)).error,
        'insufficient_stock',
        'MCP retry after app commit sees insufficient stock',
    );
    equal(
        await balance('bean_stock_events', raceBean, 'delta_grams'),
        300,
        '1000 minus app700 and MCP700 cannot become -400',
    );
    const [{ n: raceSession }] =
        await admin`select count(*)::integer as n from roast_sessions where id=${raceArgs.production_id}`;
    equal(raceSession, 0, 'racing failed production has no session');

    // An app save with no inventory events does not take the inventory lock.
    const sameProduction = crypto.randomUUID();
    const savedWithoutStock = Promise.withResolvers<void>();
    const releaseWithoutStock = Promise.withResolvers<void>();
    const noStockTransaction = native(async (sql) => {
        await sql`select save_roast_op(${sql.json({ id: sameProduction, user_id: owner, bean_id: bean, weight_grams: 100, status: 'completed' })}::jsonb,false,0,0,false)`;
        savedWithoutStock.resolve();
        await releaseWithoutStock.promise;
    });
    let waitingMcp: Promise<JsonRecord> | undefined;
    try {
        await Promise.race([
            savedWithoutStock.promise,
            noStockTransaction.then(() => {
                throw new Error('App no-stock transaction unexpectedly ended');
            }),
        ]);
        waitingMcp = write(rw.hash, 'record_roast_production', {
            ...roastArgs,
            production_id: sameProduction,
            request_id: crypto.randomUUID(),
        });
        let waiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            const [{ n }] =
                await admin`select count(*)::integer as n from pg_stat_activity where wait_event_type='Lock' and query like '%private.mcp_write%'`;
            if (n > 0) {
                waiting = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        check(waiting, 'same-ID race reaches actual row conflict wait');
    } finally {
        releaseWithoutStock.resolve();
        await noStockTransaction;
    }
    if (!waitingMcp) throw new Error('Expected concurrent MCP attempt');
    equal(
        (await waitingMcp).error,
        'production_exists',
        'app no-stock save winning same ID cannot get MCP production receipt',
    );

    const mcpRaceBean = crypto.randomUUID();
    await admin`insert into beans(id,user_id,name) values(${mcpRaceBean},${owner},'MCP race fixture')`;
    await admin`insert into bean_stock_events(user_id,bean_id,delta_grams,event_type) values(${owner},${mcpRaceBean},1000,'purchase')`;
    const firstMcpSaved = Promise.withResolvers<void>();
    const releaseFirstMcp = Promise.withResolvers<void>();
    const firstMcpArgs = args({
        production_id: crypto.randomUUID(),
        bean_id: mcpRaceBean,
        input_weight_g: 700,
        output_weight_g: 595,
        roasted_at: '2026-11-01T09:00:00Z',
    });
    const secondMcpArgs = { ...firstMcpArgs, request_id: crypto.randomUUID(), production_id: crypto.randomUUID() };
    await admin`update order_lines set status='active', product_id=${bean} where id=${bean}`;
    const beforeOrderUnits = await balance('product_stock_events', bean, 'delta_units');
    const firstMcpTransaction = admin.begin(async (sql) => {
        await sql`set local role mcp_gateway_test`;
        const [{ result }] =
            await sql`select private.mcp_write(${rw.hash},${issuer},${resource},'record_roast_production',${sql.json(firstMcpArgs)}::jsonb) as result`;
        check(result.result, 'first concurrent MCP production succeeds');
        firstMcpSaved.resolve();
        await releaseFirstMcp.promise;
    });
    try {
        await Promise.race([
            firstMcpSaved.promise,
            firstMcpTransaction.then(() => {
                throw new Error('MCP transaction unexpectedly ended');
            }),
        ]);
        equal(
            (await write(rw.hash, 'record_roast_production', secondMcpArgs)).error,
            'inventory_busy',
            'concurrent MCP production fails fast',
        );
        await denied(
            async (sql) => {
                await sql`select fulfill_order(${bean})`;
            },
            'native order row lock does not wait on MCP inventory lock',
            '40001',
        );
        equal(
            await balance('product_stock_events', bean, 'delta_units'),
            beforeOrderUnits,
            'busy order rolls back stock debit',
        );
        const [{ fulfilled_at: busyFulfilled }] = await admin`select fulfilled_at from orders where id=${bean}`;
        equal(busyFulfilled, null, 'busy order does not mark fulfillment');
    } finally {
        releaseFirstMcp.resolve();
        await firstMcpTransaction;
    }
    equal(
        (await write(rw.hash, 'record_roast_production', secondMcpArgs)).error,
        'insufficient_stock',
        'second concurrent MCP retry sees committed shortage',
    );
    equal(
        await balance('bean_stock_events', mcpRaceBean, 'delta_grams'),
        300,
        'concurrent MCP productions cannot overspend',
    );
    await native(async (sql) => {
        await sql`select fulfill_order(${bean})`;
    });
    equal(
        await balance('product_stock_events', bean, 'delta_units'),
        beforeOrderUnits - 2,
        'native order succeeds after inventory lock release',
    );
    const [{ fulfilled_at: committedFulfilled }] = await admin`select fulfilled_at from orders where id=${bean}`;
    check(committedFulfilled instanceof Date, 'native order fulfillment commits with debit');

    await service.revoke(new URLSearchParams({ client_id: 'fixture-client', token: rw.token.access_token }));
    equal(
        (await write(rw.hash, 'receive_green_stock', args({ bean_id: bean, quantity_g: 1 }))).error,
        'invalid_token',
        'revocation checked on each write',
    );
    const [{ n: audit }] =
        await admin`select count(*)::integer as n from private.mcp_write_requests where actor_id=${member} and client_id='fixture-client'`;
    check(audit >= 6, 'write receipts record client and actor');
    const httpChecks = await runWriteHttpChecks(service, gateway);
    await Deno.stdout.write(
        new TextEncoder().encode(
            `MCP inventory SQL integration: ${checks} assertions passed (disposable PostgreSQL only).\nMCP inventory cross-repository HTTP integration: ${httpChecks} assertions passed.\n`,
        ),
    );
} catch (error) {
    if (error instanceof postgres.PostgresError)
        await Deno.stderr.write(new TextEncoder().encode(`After ${checks} checks: ${error.where ?? error.message}\n`));
    throw error;
} finally {
    await Promise.all([admin.end(), app.end(), store.close(), gateway.close()]);
}
