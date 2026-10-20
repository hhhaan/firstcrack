import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkMigrationReady, readinessProbes } from './check-polar-migration-ready.mjs';
const anon=`x.${Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')}.x`;
const options={url:'https://example.invalid',anonKey:anon};
test('all three RPCs checked with complete signatures and only anonymous credentials',async()=>{
 let calls=0;
 await checkMigrationReady({...options,request:async(url,request)=>{
  const [name,payload]=readinessProbes[calls++];assert.ok(url.endsWith('/rpc/'+name));
  assert.deepEqual(JSON.parse(request.body),payload);assert.equal(request.headers.apikey,anon);
  assert.equal(request.headers.Authorization,`Bearer ${anon}`);
  return Response.json({code:'42501'},{status: calls%2?401:403});
 }});
 assert.equal(calls,3);
 assert.deepEqual(Object.keys(readinessProbes[0][1]).sort(),['p_org_id','p_event_id','p_event_at','p_user_id','p_customer_id','p_subscription','p_plan'].sort());
 assert.deepEqual(Object.keys(readinessProbes[1][1]).sort(),['p_org_id','p_event_id','p_payload'].sort());
 assert.deepEqual(Object.keys(readinessProbes[2][1]).sort(),['p_org_id','p_event_id','p_lease_id','p_sent'].sort());
});
test('missing RPC, allowed invocation, bad role, generic auth and transport all fail closed',async()=>{
 for(const [status,code]of [[404,'PGRST202'],[200,undefined],[400,'P0001'],[401,'PGRST301'],[403,'other'],[500,'42501']]) {
  await assert.rejects(()=>checkMigrationReady({...options,request:async()=>Response.json({code},{status})}));
 }
 await assert.rejects(()=>checkMigrationReady({...options,request:async()=>{throw new Error('private request details');}}),/readiness request failed/);
 await assert.rejects(()=>checkMigrationReady({...options,anonKey:`x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`}));
 await assert.rejects(()=>checkMigrationReady({...options,anonKey:''}));
});
