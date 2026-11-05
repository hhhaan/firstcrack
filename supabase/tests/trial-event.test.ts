// Run with TRIAL_EVENT_PGLITE_MODULE pointing to the pinned 0.3.14 PGlite module.
// Real SQL gates/Polar entitlement resolver on isolated fixtures. This is not a full schema replay or MVCC stress test.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.TRIAL_EVENT_PGLITE_MODULE ?? 'npm:@electric-sql/pglite@0.3.14');
const db = new PGlite();
const sql = async (path: string) => db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
await sql('./trial-event-fixture.sql');
await sql('../migrations/20260724000001_batch_gate_trial.sql');
await sql('../migrations/20260724000002_readonly_write_block.sql');
await sql('../migrations/20260810000000_readonly_write_block_service_role_exempt.sql');
// Use the actual billing guard while the fixture already has its simulator column.
const guard = await readFile(new URL('../migrations/20261015140000_profiles_simulator_enabled.sql', import.meta.url), 'utf8');
await db.exec(guard.slice(guard.indexOf('create or replace function')));
await db.exec('CREATE TRIGGER protect_billing BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION protect_profiles_billing_columns()');
await sql('../migrations/20261020133500_polar_org_cutover.sql');
// Load the actual dispatcher against fixture row types; only its plan/scope gate
// is exercised here. Production writes have their own integration suite.
const mcpMigration = await readFile(new URL('../migrations/20261101051354_mcp_inventory_production_write.sql', import.meta.url), 'utf8');
const mcpStart = mcpMigration.indexOf('CREATE FUNCTION private.mcp_write(');
await db.exec(mcpMigration.slice(mcpStart, mcpMigration.indexOf('END $$;', mcpStart) + 'END $$;'.length));
const mcpDefinitionMetadata = () => db.query("SELECT proowner, proacl, prosecdef, proconfig FROM pg_proc WHERE oid='private.mcp_write(text,text,text,text,jsonb)'::regprocedure");
const mcpMetadataBefore = (await mcpDefinitionMetadata()).rows;
const baselineTrial = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const baselinePro = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
await db.query("INSERT INTO profiles(id,plan,created_at) VALUES($1,'trial',now()),($2,'pro',now())",[baselineTrial,baselinePro]);
await db.query('INSERT INTO roast_sessions(user_id) SELECT $1 FROM generate_series(1,18)',[baselineTrial]);
await db.query("INSERT INTO roast_sessions(user_id,roasted_at) VALUES($1,date_trunc('month',now())-interval '1 day')",[baselinePro]);
await db.query('INSERT INTO roast_sessions(user_id,roasted_at) VALUES($1,NULL)',[baselinePro]);
await db.query('INSERT INTO roast_sessions(user_id) SELECT $1 FROM generate_series(1,199)',[baselinePro]);
await sql('../migrations/20261104150333_trial_event_access.sql');
assert.deepEqual((await mcpDefinitionMetadata()).rows, mcpMetadataBefore);

const owner = '11111111-1111-4111-8111-111111111111';
const tester = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const stranger = '44444444-4444-4444-8444-444444444444';
const ordinary = '55555555-5555-4555-8555-555555555555';
const session = '66666666-6666-4666-8666-666666666666';
async function scalar(query: string, args: unknown[] = []) {
    return Object.values((await db.query(query, args)).rows[0])[0];
}
async function asUser(userId: string, work: () => Promise<void>) {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [userId]);
    await db.exec('SET ROLE authenticated');
    try { await work(); } finally {
        await db.exec('RESET ROLE');
        await db.exec("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)");
    }
}
const reserve = (who: string, id: string) => db.query('SELECT reserve_roast_charge($1,$2)', [who,id]);
const release = (who: string, id: string) => db.query('SELECT release_roast_charge($1,$2)', [who,id]);
const charge = (who: string, id: string) => db.query('SELECT record_roast_charge($1,$2,clock_timestamp())', [who,id]);
const mcpGate = (who: string) => scalar("SELECT private.mcp_write($1,'fixture','fixture','invalid_tool','{}'::jsonb)->>'error'", [who]);
const counters = async () => (await db.query('SELECT used_batches, reserved_batches FROM trial_event_grants WHERE user_id=$1',[owner])).rows[0];
const usage = (who: string) => scalar('SELECT get_roast_charge_usage($1)',[who]) as Promise<{
    plan:string; used_batches:number; reserved_batches:number; batch_cap:number|null;
    period_start:string|null; period_end:string|null; denial_code:string|null;
}>;
await db.query("INSERT INTO profiles(id,plan,created_at) VALUES ($1,'tester',now()-interval '1 year'),($2,'tester',now()-interval '1 year'),($3,'trial',now()),($4,'trial',now()),($5,'trial',now())", [owner,tester,member,stranger,ordinary]);
await db.query('INSERT INTO workspace_members VALUES($1,$2)',[owner,member]);
await db.query("INSERT INTO roast_sessions(user_id) SELECT $1 FROM generate_series(1,150)",[owner]);
assert.equal(await scalar('SELECT count(*)::int FROM trial_event_grants'), 0);
await db.query("UPDATE profiles SET plan='trial-event' WHERE id=$1",[owner]);
const start = await scalar('SELECT started_at::text FROM trial_event_grants WHERE user_id=$1',[owner]);
assert.equal(await mcpGate(owner),'invalid_arguments');
assert.equal(await mcpGate(tester),'invalid_arguments');
assert.equal(await mcpGate(ordinary),'insufficient_plan');
await db.exec("SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false)");
assert.equal(Number(await scalar('SELECT extract(epoch FROM ends_at-started_at) FROM trial_event_grants WHERE user_id=$1',[owner])),90*86400);
assert.deepEqual(await counters(), {used_batches:0,reserved_batches:0});
await db.query("UPDATE profiles SET plan='tester' WHERE id=$1;",[owner]);
await db.query("UPDATE profiles SET plan='trial-event' WHERE id=$1;",[owner]);
assert.equal(await scalar('SELECT started_at::text FROM trial_event_grants WHERE user_id=$1',[owner]),start);
assert.equal(await scalar('SELECT plan FROM profiles WHERE id=$1',[tester]),'tester');

await asUser(stranger,async()=> {
    assert.equal(await scalar('SELECT count(*)::int FROM trial_event_grants'),0);
    await assert.rejects(()=>reserve(owner,session), /workspace access denied/);
    await assert.rejects(()=>release(owner,session), /workspace access denied/);
    await assert.rejects(()=>charge(owner,session), /workspace access denied/);
    await assert.rejects(()=>usage(owner), /workspace access denied/);
    await db.query("UPDATE profiles SET plan='trial-event' WHERE id=$1",[stranger]);
});
assert.equal(await scalar('SELECT plan FROM profiles WHERE id=$1',[stranger]),'trial');
await asUser(owner,async()=> {
    await assert.rejects(()=>db.exec('UPDATE trial_event_grants SET used_batches=0'), /permission denied/);
    await assert.rejects(()=>db.exec('SELECT * FROM private.roast_charge_batches'), /permission denied/);
    await reserve(owner,session);
    await reserve(owner,session);
    assert.deepEqual(await counters(),{used_batches:0,reserved_batches:1});
    await release(owner,session);
    await release(owner,session);
    assert.deepEqual(await counters(),{used_batches:0,reserved_batches:0});
    await assert.rejects(()=>reserve(owner,session),/invalid roast Charge reservation/);
    await assert.rejects(()=>charge(owner,session),/invalid roast Charge reservation/);
    await assert.rejects(()=>charge(owner,crypto.randomUUID()),/reservation required/);
    const invite=await scalar("SELECT create_org_invite('abcdefghijklmnopqrstuv')");
    assert.ok(invite);
    // A charged, discarded roast stays used even without any saved session.
    const discarded = crypto.randomUUID();
    await reserve(owner,discarded);
    await charge(owner,discarded);
    await charge(owner,discarded);
    await release(owner,discarded);
    assert.deepEqual(await counters(),{used_batches:1,reserved_batches:0});
    assert.equal(await scalar('SELECT count(*)::int FROM roast_sessions WHERE id=$1',[discarded]),0);
    // Saving can beat a delayed Charge request; the late acknowledgement is free.
    const savedFirst = crypto.randomUUID();
    await reserve(owner,savedFirst);
    await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[savedFirst,owner]);
    await charge(owner,savedFirst);
    await release(owner,savedFirst);
    assert.deepEqual(await counters(),{used_batches:2,reserved_batches:0});
});
const last='77777777-7777-4777-8777-777777777777';
const plan='88888888-8888-4888-8888-888888888888';
const batch='99999999-9999-4999-8999-999999999999';
// An old discarded Charge must not leave schedule writes open indefinitely.
await db.query("UPDATE private.roast_charge_batches SET usage_at=now()-interval '25 hours' WHERE user_id=$1 AND state='charged'",[owner]);
await asUser(member,async()=> {
    assert.equal(await scalar('SELECT count(*)::int FROM trial_event_grants'),1);
    await reserve(owner,last);
    for(let i=0;i<97;i++) await db.query('INSERT INTO roast_sessions(user_id) VALUES($1)',[owner]);
    assert.deepEqual(await counters(),{used_batches:99,reserved_batches:1});
    await assert.rejects(()=>reserve(owner,crypto.randomUUID()),/trial_event_batch_cap/);
    await assert.rejects(()=>db.query('INSERT INTO roast_sessions(id,user_id,weight_grams) VALUES($1,$2,-1)',[last,owner]),/check constraint/);
    assert.deepEqual(await counters(),{used_batches:99,reserved_batches:1});
    await charge(owner,last);
    await release(owner,last);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    await assert.rejects(()=>reserve(owner,crypto.randomUUID()),/trial_event_batch_cap/);
    await assert.rejects(()=>db.query('INSERT INTO roast_sessions(id,user_id,weight_grams) VALUES($1,$2,-1)',[last,owner]),/check constraint/);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    const capPlan = crypto.randomUUID();
    await db.query('INSERT INTO roast_day_plans(id,user_id) VALUES($1,$2)',[capPlan,owner]);
    await db.query('INSERT INTO roast_plan_batches(plan_id) VALUES($1)',[capPlan]);
});
await db.query("UPDATE trial_event_grants SET started_at=started_at-interval '91 days', ends_at=ends_at-interval '91 days' WHERE user_id=$1",[owner]);
await asUser(owner,async()=> {
    assert.equal(await mcpGate(owner),'insufficient_plan');
    await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)");
    await assert.rejects(()=>reserve(owner,crypto.randomUUID()),/trial_event_expired/);
    await charge(owner,last);
    await assert.rejects(()=>db.query('INSERT INTO roast_sessions(user_id) VALUES($1)',[owner]),/trial_event_expired/);
    // Summary materializes a recurring occurrence in separate requests before saving.
    await db.query('INSERT INTO roast_day_plans(id,user_id) VALUES($1,$2)',[plan,owner]);
    await db.query('INSERT INTO roast_plan_batches(id,plan_id) VALUES($1,$2)',[batch,plan]);
    // The admitted roast and its atomic stock writes complete after expiry.
    await db.query(`WITH saved AS (INSERT INTO roast_sessions(id,user_id,plan_batch_id) VALUES($1,$2,$3) RETURNING id,user_id)
      INSERT INTO bean_stock_events(user_id,reference_id,delta_grams) SELECT user_id,id,-1000 FROM saved`,[last,owner,batch]);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[last,owner]);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    await release(owner,last);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    await db.query("UPDATE roast_sessions SET tsv_path='profiles/test.tsv' WHERE id=$1",[last]);
    await db.query("UPDATE roast_plan_batches SET status='done' WHERE id=$1",[batch]);
    await assert.rejects(()=>db.query("UPDATE roast_plan_batches SET status='pending' WHERE id=$1",[batch]),/trial_event_expired/);
    await assert.rejects(()=>db.query("UPDATE roast_plan_batches SET batch_count=2 WHERE id=$1",[batch]),/trial_event_expired/);
    await assert.rejects(()=>db.query("UPDATE roast_sessions SET notes='edit' WHERE id=$1",[last]),/trial_event_expired/);
    await assert.rejects(()=>db.query('INSERT INTO bean_stock_events(user_id,delta_grams) VALUES($1,-1)',[owner]),/trial_event_expired/);
    await db.query('DELETE FROM roast_sessions WHERE id=$1',[last]);
    assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
    await assert.rejects(()=>db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[last,owner]),/was deleted/);
});
// MCP writes also stop at the Charge cap even when the time window is active.
await db.query("UPDATE trial_event_grants SET started_at=started_at+interval '91 days', ends_at=ends_at+interval '91 days' WHERE user_id=$1",[owner]);
assert.equal(await mcpGate(owner),'insufficient_plan');
// Ordinary trial stays at 20; tester remains unlimited.
await asUser(ordinary,async()=> {
    for(let i=0;i<20;i++) await db.query('INSERT INTO roast_sessions(user_id) VALUES($1)',[ordinary]);
    await assert.rejects(()=>db.query('INSERT INTO roast_sessions(user_id) VALUES($1)',[ordinary]),/trial_batch_cap/);
});
await db.query("UPDATE profiles SET created_at=now()-interval '15 days' WHERE id=$1",[ordinary]);
assert.equal(await scalar('SELECT profile_write_error($1)',[ordinary]),'trial_expired');
await asUser(tester,async()=> { for(let i=0;i<101;i++) await db.query('INSERT INTO roast_sessions(user_id) VALUES($1)',[tester]); });
assert.equal(await scalar('SELECT count(*)::int FROM trial_event_grants WHERE user_id=$1',[tester]),0);
// Existing ordinary trials retain completed-history usage and then count Charge,
// including discarded sessions with no saved history. Their last save may finish late.
const lastTrial = crypto.randomUUID();
await asUser(baselineTrial,async()=> {
    assert.equal((await usage(baselineTrial)).used_batches,18);
    await db.query('DELETE FROM roast_sessions WHERE id=(SELECT id FROM roast_sessions WHERE user_id=$1 LIMIT 1)',[baselineTrial]);
    assert.equal((await usage(baselineTrial)).used_batches,18);
    const discarded = crypto.randomUUID();
    await reserve(baselineTrial,discarded); await charge(baselineTrial,discarded); await release(baselineTrial,discarded);
    await reserve(baselineTrial,lastTrial);
    await charge(baselineTrial,lastTrial); await charge(baselineTrial,lastTrial);
    assert.equal((await usage(baselineTrial)).used_batches,20);
    assert.equal((await usage(baselineTrial)).batch_cap,20);
    await assert.rejects(()=>reserve(baselineTrial,crypto.randomUUID()),/trial_batch_cap/);
});
await db.query("UPDATE profiles SET created_at=created_at-interval '15 days' WHERE id=$1",[baselineTrial]);
await asUser(baselineTrial,async()=> {
    await db.query(`WITH saved AS (INSERT INTO roast_sessions(id,user_id) VALUES($1,$2) RETURNING id,user_id)
      INSERT INTO bean_stock_events(user_id,reference_id,delta_grams) SELECT user_id,id,-1000 FROM saved`,[lastTrial,baselineTrial]);
    await db.query("UPDATE roast_sessions SET tsv_path='late-trial.tsv' WHERE id=$1",[lastTrial]);
    assert.equal((await usage(baselineTrial)).used_batches,20);
    await assert.rejects(()=>reserve(baselineTrial,crypto.randomUUID()),/trial_expired/);
    await assert.rejects(()=>db.query("UPDATE roast_sessions SET notes='edit' WHERE id=$1",[lastTrial]),/trial_expired/);
});

// Pro's UTC monthly baseline excludes earlier months. Members share its last slot.
await db.query('INSERT INTO workspace_members VALUES($1,$2)',[baselinePro,member]);
const lastPro = crypto.randomUUID();
await asUser(member,async()=> {
    assert.equal((await usage(baselinePro)).used_batches,199);
    await reserve(baselinePro,lastPro); await reserve(baselinePro,lastPro);
    await assert.rejects(()=>reserve(baselinePro,crypto.randomUUID()),/monthly_batch_cap_exceeded/);
    await charge(baselinePro,lastPro); await release(baselinePro,lastPro);
    assert.equal((await usage(baselinePro)).used_batches,200);
    await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[lastPro,baselinePro]);
    await db.query('DELETE FROM roast_sessions WHERE id=$1',[lastPro]);
    assert.equal((await usage(baselinePro)).used_batches,200);
    // The monthly roast cap does not freeze unrelated inventory writes.
    await db.query('INSERT INTO bean_stock_events(user_id,delta_grams) VALUES($1,1)',[baselinePro]);
});
// Moving the fixture to the preceding window models a completed monthly rollover.
await db.query("UPDATE private.roast_charge_batches SET usage_at=usage_at-interval '1 month' WHERE user_id=$1",[baselinePro]);
await asUser(baselinePro,async()=> {
    assert.equal((await usage(baselinePro)).used_batches,0);
    const next = crypto.randomUUID(); await reserve(baselinePro,next); await charge(baselinePro,next);
    assert.equal((await usage(baselinePro)).used_batches,1);
});

// Unlimited plans record Charge without any online preparation or new limit.
for(const planName of ['tester','pro_plus','enterprise','team']) {
    const unlimitedOwner = crypto.randomUUID();
    const foreignPending = crypto.randomUUID();
    await db.query("INSERT INTO roast_sessions(id,user_id,status) VALUES($1,$2,'in_progress')",[foreignPending,baselinePro]);
    await db.query('INSERT INTO profiles(id,plan) VALUES($1,$2)',[unlimitedOwner,planName]);
    await asUser(unlimitedOwner,async()=> {
        await assert.rejects(()=>charge(unlimitedOwner,foreignPending),/workspace access denied/);
        await db.query('SELECT record_roast_charge($1,gen_random_uuid(),clock_timestamp()) FROM generate_series(1,201)',[unlimitedOwner]);
        const before = await usage(unlimitedOwner);
        assert.equal(before.used_batches,201); assert.equal(before.batch_cap,null); assert.equal(before.denial_code,null);
        const id = crypto.randomUUID(); await charge(unlimitedOwner,id); await charge(unlimitedOwner,id); await release(unlimitedOwner,id);
        await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[id,unlimitedOwner]);
        assert.equal((await usage(unlimitedOwner)).used_batches,202);
        // A delayed offline acknowledgement retains its occurrence month.
        await db.query("SELECT record_roast_charge($1,gen_random_uuid(),date_trunc('month',now())-interval '1 day')",[unlimitedOwner]);
        assert.equal((await usage(unlimitedOwner)).used_batches,202);
    });
}
// Both Charge acknowledgements and saves can arrive after the admission deadline.
const delayedOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const delayedCharge = crypto.randomUUID();
const delayedSave = crypto.randomUUID();
await db.query("INSERT INTO profiles(id,plan) VALUES($1,'trial-event')",[delayedOwner]);
await asUser(delayedOwner,async()=> {
    await reserve(delayedOwner,delayedCharge);
    await reserve(delayedOwner,delayedSave);
});
await db.query("UPDATE trial_event_grants SET started_at=started_at-interval '91 days', ends_at=ends_at-interval '91 days' WHERE user_id=$1",[delayedOwner]);
await asUser(delayedOwner,async()=> {
    // An acknowledgement can be offline while the admitted save resolves its schedule.
    const pendingPlan = crypto.randomUUID();
    await db.query('INSERT INTO roast_day_plans(id,user_id) VALUES($1,$2)',[pendingPlan,delayedOwner]);
    await db.query('INSERT INTO roast_plan_batches(plan_id) VALUES($1)',[pendingPlan]);
    await charge(delayedOwner,delayedCharge);
    await release(delayedOwner,delayedCharge);
    await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[delayedCharge,delayedOwner]);
    await db.query('INSERT INTO roast_sessions(id,user_id) VALUES($1,$2)',[delayedSave,delayedOwner]);
    await charge(delayedOwner,delayedSave);
    assert.deepEqual((await db.query('SELECT used_batches,reserved_batches FROM trial_event_grants WHERE user_id=$1',[delayedOwner])).rows[0],{used_batches:2,reserved_batches:0});
});
const staleOwner = crypto.randomUUID();
const staleCharge = crypto.randomUUID();
const stalePlan = crypto.randomUUID();
await db.query("INSERT INTO profiles(id,plan,created_at) VALUES($1,'trial',now())",[staleOwner]);
await asUser(staleOwner,async()=> { await reserve(staleOwner,staleCharge); });
await db.query("UPDATE profiles SET created_at=now()-interval '15 days' WHERE id=$1",[staleOwner]);
await asUser(staleOwner,async()=> {
    await db.query('INSERT INTO roast_day_plans(id,user_id) VALUES($1,$2)',[stalePlan,staleOwner]);
    await db.query('INSERT INTO roast_plan_batches(plan_id) VALUES($1)',[stalePlan]);
    await assert.rejects(()=>db.query('INSERT INTO roast_day_plans(user_id) VALUES($1)',[tester]),/row-level security/);
});
await db.query("UPDATE private.roast_charge_batches SET usage_at=now()-interval '25 hours' WHERE session_id=$1",[staleCharge]);
await asUser(staleOwner,async()=> {
    await assert.rejects(()=>db.query('INSERT INTO roast_day_plans(user_id) VALUES($1)',[staleOwner]),/trial_expired/);
    await assert.rejects(()=>db.query('INSERT INTO roast_plan_batches(plan_id) VALUES($1)',[stalePlan]),/trial_expired/);
});
await db.query("UPDATE private.roast_charge_batches SET usage_at=now() WHERE session_id=$1",[staleCharge]);
await db.query("UPDATE profiles SET plan='read_only' WHERE id=$1",[staleOwner]);
await asUser(staleOwner,async()=> {
    await assert.rejects(()=>db.query('INSERT INTO roast_day_plans(user_id) VALUES($1)',[staleOwner]),/read_only_plan/);
    await assert.rejects(()=>db.query('INSERT INTO roast_plan_batches(plan_id) VALUES($1)',[stalePlan]),/read_only_plan/);
});
// Actual Polar resolver upgrades event trials, retains tester, and never renews grants.
const org='3b6494cb-8248-47d1-a5f2-65ff7ca9b8a8';
for(const user of [owner,tester]) {
    await db.query('SELECT apply_polar_subscription_event($1,$2,now(),$3,$4,$5,$6)',[
        org,user,user,user,{id:user,status:'active',current_period_end:'2099-01-01T00:00:00Z'},'pro_plus',
    ]);
}
assert.equal(await scalar('SELECT plan FROM profiles WHERE id=$1',[owner]),'pro_plus');
assert.equal(await scalar('SELECT plan FROM profiles WHERE id=$1',[tester]),'tester');
assert.deepEqual(await counters(),{used_batches:100,reserved_batches:0});
assert.equal(await scalar("SELECT has_function_privilege('anon','reserve_roast_charge(uuid,uuid)','EXECUTE')"),false);
assert.equal(await scalar("SELECT has_function_privilege('anon','get_roast_charge_usage(uuid)','EXECUTE')"),false);
assert.equal(await scalar("SELECT has_function_privilege('authenticated','private.roast_charge_usage(uuid)','EXECUTE')"),false);
assert.equal(await scalar("SELECT has_function_privilege('anon','record_roast_charge(uuid,uuid,timestamptz)','EXECUTE')"),false);
assert.equal(await scalar("SELECT pg_get_function_result('public.record_roast_charge(uuid,uuid,timestamptz)'::regprocedure)"),'void');
assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid='trial_event_grants'::regclass"),true);
assert.deepEqual((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='trial_event_grants' ORDER BY column_name")).rows.map((r: {column_name:string})=>r.column_name), ['ends_at','reserved_batches','started_at','used_batches','user_id']);
await db.close();
console.log('Charge usage: baseline, all plan caps, unlimited/offline, permissions, discard/retry/rollback, expiry/months, late saves, stock, deletion and Polar passed');
