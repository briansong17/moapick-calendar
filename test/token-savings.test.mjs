import test from 'node:test';import assert from 'node:assert/strict';
import {extract,inputHash} from '../lib/extraction.mjs';
import {createCollection} from '../cloud/collection.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
test('identical image bytes are sent once, preserve distinct images, model and high fidelity',async()=>{
 const other=image+'x';let body;
 await extract({images:[image,image,other],caption:'caption'},{model:'gpt-5.4-mini',apiKey:'fixture',fetchImpl:async(_,o)=>{body=JSON.parse(o.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'',events:[],warnings:[]})}]}]});}});
 assert.equal(body.model,'gpt-5.4-mini');assert.equal(body.text.verbosity,'low');assert.equal(body.max_output_tokens,6000);
 const sent=body.input[0].content.filter(c=>c.type==='input_image');assert.equal(sent.length,2);assert.ok(sent.every(c=>c.detail==='high'));assert.equal(sent[1].image_url,other);
 assert.equal(inputHash({images:[image,image],caption:'same'},'model'),inputHash({images:[image],caption:'same'},'model'));
 assert.notEqual(inputHash({images:[image],caption:'changed'},'model'),inputHash({images:[image],caption:'same'},'model'));
});
test('legacy generation cache is reused privately and promoted to a stable zero-token record',async()=>{
 const raw={images:[image],caption:'',account:'school',source_url:'',posted_at:''};let calls=0,saved;
 const legacy={id:'old',hash:inputHash(raw,'gpt-5.4-mini:owner:test:generation'),owner_id:'owner',metadata:{model:'gpt-5.4-mini'},status:'complete',result:{summary:'existing',events:[],warnings:[]}};
 const db={rpc:async()=>true,admin:async(t,q,o)=>{
  if(t==='moa_locks')return [];
  assert.equal(t,'moa_analyses');
  if(o?.method==='POST'){saved={id:'fresh',...o.body};return [saved];}
  assert.equal(q.owner_id,'eq.owner');return q.hash==='eq.'+legacy.hash?[legacy]:[];
 }};
 const c=createCollection({db,env:{OPENAI_API_KEY:'fixture'},scope:{uid:'owner',generation:'generation'},analyze:async()=>{calls++;throw Error('must use cache');}});
 const r=await c.analyzeInput(raw);assert.equal(calls,0);assert.equal(r.id,'fresh');assert.equal(r.usage.total_tokens,0);assert.equal(saved.owner_id,'owner');assert.equal(saved.hash,inputHash(raw,'gpt-5.4-mini:owner'));assert.deepEqual(saved.result,legacy.result);assert.equal(saved.reviewed,undefined);assert.equal(saved.deleted_indices,undefined);
});

test('a reset can reuse a prior generation only after verifying its exact hash',async()=>{
 const raw={images:[image],caption:'same',account:'school',source_url:'https://www.instagram.com/p/example/',posted_at:''};let paid=0;
 const prior={id:'before-reset',hash:inputHash(raw,'gpt-5.4-mini:owner:test:before'),metadata:{model:'gpt-5.4-mini',source_url:raw.source_url,test_generation:'before'},result:{summary:'cached',events:[],warnings:[]}};
 const db={rpc:async()=>true,admin:async(t,q,o)=>{
  if(t==='moa_locks')return [];
  if(o?.method==='POST'){assert.equal(o.body.owner_id,'owner');return [{id:'after-reset',...o.body}];}
  assert.equal(q.owner_id,'eq.owner');
  if(q.hash)return [];
  assert.equal(q['metadata->>source_url'],'eq.'+raw.source_url);return [prior];
 }};
 const c=createCollection({db,scope:{uid:'owner',generation:'after'},env:{OPENAI_API_KEY:'fixture'},analyze:async()=>{paid++;throw Error('no paid call');}});
 const row=await c.analyzeInput(raw);assert.equal(paid,0);assert.equal(row.id,'after-reset');assert.equal(row.usage.total_tokens,0);assert.equal(row.metadata.test_generation,'after');
});
