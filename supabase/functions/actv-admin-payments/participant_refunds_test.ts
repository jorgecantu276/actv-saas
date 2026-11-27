import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { adminPaymentsHandler } from './index.ts';

const order='00000000-0000-4000-8000-000000000010',id='00000000-0000-4000-8000-000000000011',item='00000000-0000-4000-8000-000000000012';
const actor='00000000-0000-4000-8000-000000000013';
const canonical={id:'re_TestPartial',charge:'ch_TestCharge',payment_intent:'pi_TestPayment',amount:50000,currency:'mxn',status:'succeeded',metadata:{actv_refund_request_id:id}};
async function scenario(options:{requestedAt?:string;lost?:boolean;wrongAmount?:boolean;known?:boolean}={}){
 const fetch=globalThis.fetch,env=new Map<string,string|undefined>();
 for(const [k,v] of Object.entries({SUPABASE_URL:'http://127.0.0.1:55401',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only',ACTV_STRIPE_MODE:'test',ACTV_STRIPE_SECRET_KEY:'sk_test_synthetic'})){env.set(k,Deno.env.get(k));Deno.env.set(k,v);}
 let creates=0,records=0,reserved=false,exists=options.known??false,lost=options.lost?2:0;
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url);
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
  if(url.pathname.endsWith('/actv_begin_participant_refund')){
   const body=await req.json();equal(body.p_request,id);equal(body.p_items,[item]);reserved=true;
   return Response.json({id,order_id:order,item_ids:[item],amount:50000,captured:150000,requested_at:options.requestedAt??new Date(Date.now()-1000).toISOString(),reason:'Participant cancel',refund_application_fee:false,participant_scoped:true,provider_refund_id:null,status:'requested',account_id:'acct_TestOrganizer',charge_id:'ch_TestCharge',payment_id:'pi_TestPayment',currency:'mxn',live_mode:false,channel:'online'});
  }
  if(url.pathname.endsWith('/actv_check_participant_refund_provider')){ok(reserved);return Response.json(null);}
  if(url.pathname.endsWith('/actv_record_participant_refund')){records++;equal((await req.json()).p_refund,canonical.id);return Response.json({status:'succeeded',amount:50000});}
  if(url.hostname==='api.stripe.com'){
   equal(req.headers.get('stripe-account'),'acct_TestOrganizer');
   if(url.pathname==='/v1/charges/ch_TestCharge')return Response.json({id:'ch_TestCharge',livemode:false,payment_intent:'pi_TestPayment',amount_captured:150000,currency:'mxn',paid:true,captured:true,disputed:false,amount_refunded:exists?50000:0,payment_method_details:{type:'card'}});
   if(url.pathname==='/v1/refunds'&&req.method==='GET')return Response.json({data:exists?[{...canonical,amount:options.wrongAmount?100:50000}]:[],has_more:false});
   if(url.pathname==='/v1/refunds'&&req.method==='POST'){
    creates++;equal(req.headers.get('idempotency-key'),'actv-participant-refund-'+id);
    const p=new URLSearchParams(await req.text());equal(p.get('amount'),'50000');equal(p.get('charge'),'ch_TestCharge');equal(p.get('metadata[actv_refund_request_id]'),id);
    exists=true;if(lost-->0){throw new TypeError('Synthetic lost response');}
    return Response.json(canonical);
   }
  }
  throw new Error('Unexpected '+req.method+' '+url.pathname);
 };
 const run=()=>adminPaymentsHandler(new Request('http://local.invalid',{method:'POST',headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},body:JSON.stringify({action:'participant-refund',orderId:order,requestId:id,itemIds:[item],reason:'Participant cancel',refundCommission:false,participantScoped:true,confirmed:true})}));
 try{const first=await run();const second=options.requestedAt||options.wrongAmount?null:await run();return{first:first.status,second:second?.status,creates,records};}
 finally{globalThis.fetch=fetch;for(const[k,v]of env){if(v===undefined)Deno.env.delete(k);else Deno.env.set(k,v);}}
}
Deno.test('selected refund posts immutable amount once; lost response recovers original metadata and request',async()=>{
 const r=await scenario({lost:true});equal(r.first,503);equal(r.second,200);equal(r.creates,2);equal(r.records,1);
});
Deno.test('refund recovery never posts for invalid, future or 23h timestamps',async()=>{
 for(const requestedAt of ['invalid',new Date(Date.now()+60000).toISOString(),new Date(Date.now()-23*3600000).toISOString()]){
  const r=await scenario({requestedAt});equal(r.first,409);equal(r.creates,0);equal(r.records,0);
 }
});
Deno.test('older requests recover read-only and wrong provider amounts never enter ledger',async()=>{
 const old=await scenario({requestedAt:new Date(Date.now()-30*3600000).toISOString(),known:true});equal(old.first,200);equal(old.creates,0);equal(old.records,1);
 const bad=await scenario({known:true,wrongAmount:true});equal(bad.first,409);equal(bad.records,0);equal(bad.creates,0);
});
