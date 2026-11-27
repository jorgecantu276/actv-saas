import assert from 'node:assert/strict';
import { adminPaymentsHandler } from '../../supabase/functions/actv-admin-payments/index.ts';
const input=JSON.parse(await new Response(Deno.stdin.readable).text()),api=new URL(input.apiUrl);
assert.equal(api.hostname,'127.0.0.1');
for(const[k,v]of Object.entries({SUPABASE_URL:api.origin,SUPABASE_SECRET_KEYS:JSON.stringify({default:input.serviceKey}),ACTV_STRIPE_MODE:'test',ACTV_STRIPE_SECRET_KEY:'sk_test_synthetic',ACTV_APP_URL:'http://127.0.0.1:3000'}))Deno.env.set(k,String(v));
const original=globalThis.fetch;let posts=0,lost=2,exists=false;
const result={id:'re_'+input.request.replaceAll('-',''),charge:input.charge,payment_intent:input.payment,amount:50000,currency:'mxn',status:'succeeded',metadata:{actv_refund_request_id:input.request}};
globalThis.fetch=async(req,init)=>{
 const request=new Request(req,init),url=new URL(request.url);
 if(url.origin===api.origin)return original(req,init);
 assert.equal(url.hostname,'api.stripe.com');assert.equal(request.headers.get('stripe-account'),input.account);
 if(url.pathname==='/v1/charges/'+input.charge)return Response.json({id:input.charge,livemode:false,payment_intent:input.payment,amount_captured:150000,currency:'mxn',paid:true,captured:true,disputed:false,amount_refunded:exists?50000:0,payment_method_details:{type:'card'}});
 if(url.pathname==='/v1/refunds'&&request.method==='GET')return Response.json({data:exists?[result]:[],has_more:false});
 if(url.pathname==='/v1/refunds'&&request.method==='POST'){
  posts++;assert.equal(request.headers.get('idempotency-key'),'actv-participant-refund-'+input.request);
  const body=new URLSearchParams(await request.text());assert.equal(body.get('amount'),'50000');assert.equal(body.get('charge'),input.charge);
  exists=true;if(lost-->0)throw new TypeError('Synthetic lost provider response');return Response.json(result);
 }
 if(url.pathname==='/v1/refunds/'+result.id)return Response.json(result);
 throw new Error('Unexpected synthetic provider request');
};
const call=(token:string)=>adminPaymentsHandler(new Request(api.origin+'/refund',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({action:'participant-refund',orderId:input.order,requestId:input.request,itemIds:[input.item],reason:'Participant cancelled; preserve unaffected paid group',participantScoped:true,refundCommission:false,confirmed:true})}));
assert.equal((await call(input.deniedToken)).status,403);
assert.equal((await call(input.token)).status,503);
assert.equal(posts,2);
assert.equal((await call(input.token)).status,200);
assert.equal((await call(input.token)).status,200);
assert.equal(posts,2);
console.log(JSON.stringify({assertions:6,providerPostAttempts:posts,logicalRefunds:1}));
