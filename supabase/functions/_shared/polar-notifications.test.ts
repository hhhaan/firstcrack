import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deliverPolarNotification, polarNotificationPayload } from './polar-notifications.ts';

test('missing Slack configuration remains retryable and releases lease', async () => {
    const calls: Array<{name:string;args:Record<string,unknown>}> = [];
    const rpc = async (name:string,args:Record<string,unknown>) => {
        calls.push({name,args});
        return { data: name==='claim_polar_notification' ? {status:'claimed',lease_id:'lease',payload:{text:'stored'}} : true, error:null };
    };
    await assert.rejects(()=>deliverPolarNotification({rpc},'org','order.paid:x',{text:'new'},async()=>false));
    assert.equal(calls[1].args.p_sent,false);
});
test('send canonical payload; finish only on success; sent and busy never send', async () => {
    let sends=0; let finished=false;
    const rpc=async(name:string,args:Record<string,unknown>)=>({data:name==='claim_polar_notification'?{status:'claimed',lease_id:'lease',payload:{text:'stored'}}:(finished=args.p_sent===true),error:null});
    await deliverPolarNotification({rpc},'org','subscription.created:x',{text:'new'},async payload=>{sends++;assert.equal(payload.text,'stored');return true;});
    assert.equal(sends,1); assert.equal(finished,true);
    for(const status of ['sent','busy']) {
        const client={rpc:async()=>({data:{status},error:null})};
        const run=()=>deliverPolarNotification(client,'org','order.paid:x',{text:'new'},async()=>{throw new Error('must not send');});
        if(status==='sent') await run(); else await assert.rejects(run);
    }
});
test('transport exception releases lease and finish failures stay retryable', async()=>{
    let released=false;
    const client={rpc:async(name:string,args:Record<string,unknown>)=>({data:name==='claim_polar_notification'?{status:'claimed',lease_id:'lease',payload:{text:'stored'}}:(released=args.p_sent===false),error:null})};
    await assert.rejects(()=>deliverPolarNotification(client,'org','order.paid:x',{text:'new'},async()=>{throw new Error('offline');}));
    assert.equal(released,true);
    const broken={rpc:async(name:string)=>({data:name==='claim_polar_notification'?{status:'claimed',lease_id:'lease',payload:{text:'stored'}}:false,error:null})};
    await assert.rejects(()=>deliverPolarNotification(broken,'org','order.paid:x',{text:'new'},async()=>true));
});
test('preserves subscription and paid order notification details',()=>{
    const data={customer:{external_id:'user'},amount:1200,currency:'usd',status:'active',recurring_interval:'month',product_id:'product'};
    const subscription=polarNotificationPayload('subscription.created',data,'pro').text;
    for(const part of ['Payment / subscription','user','USD 12.00','pro','month']) assert.ok(subscription.includes(part));
    const order=polarNotificationPayload('order.paid',{customer_id:'customer',total_amount:2500,currency:'krw'}).text;
    for(const part of ['Payment received','customer','KRW 25.00','paid']) assert.ok(order.includes(part));
});
test('real Slack helper with absent webhook does not acknowledge delivery', async()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'Deno');
    Object.defineProperty(globalThis,'Deno',{configurable:true,value:{env:{get:()=>undefined}}});
    try {
        const {postSlack}=await import('./slack.ts');
        let failedLease=false;
        const client={rpc:async(name:string,args:Record<string,unknown>)=>({data:name==='claim_polar_notification'?{status:'claimed',lease_id:'lease',payload:{text:'stored'}}:(failedLease=args.p_sent===false),error:null})};
        await assert.rejects(()=>deliverPolarNotification(client,'org','order.paid:x',{text:'new'},postSlack));
        assert.equal(failedLease,true);
    } finally {
        if(previous) Object.defineProperty(globalThis,'Deno',previous); else Reflect.deleteProperty(globalThis,'Deno');
    }
});
