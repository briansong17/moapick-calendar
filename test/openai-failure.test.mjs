import test from 'node:test';import assert from 'node:assert/strict';
import {openaiFailure} from '../lib/openai-failure.mjs';
import {extract} from '../lib/extraction.mjs';
test('OpenAI 429 captures token/request limits without organization IDs or raw messages',async()=>{
 const r=new Response('',{status:429,headers:{'retry-after':'45','x-ratelimit-limit-tokens':'30000'}});
 const details=openaiFailure(r,{code:'rate_limit_exceeded',message:'Request too large in organization org-PRIVATE on tokens per min (TPM): Limit 30000, Requested 45000'});
 assert.equal(details.code,'request_too_large');assert.equal(details.limit,30000);assert.equal(details.requested,45000);assert.equal(details.retryAfterSeconds,45);assert.doesNotMatch(JSON.stringify(details),/PRIVATE|organization/);
 await assert.rejects(extract({images:[],caption:''},{fetchImpl:async()=>Response.json({error:{code:'rate_limit_exceeded',message:'Rate limit on requests per min (RPM): Limit 3, Requested 1 secret-sentinel'}},{status:429,headers:{'retry-after':'80'}})}),e=>e.status===429&&e.provider.code==='requests_per_minute'&&e.retryAfterSeconds===80&&!JSON.stringify(e).includes('sentinel'));
});
test('OpenAI billing limits are distinguished from temporary throttles',()=>{
 assert.equal(openaiFailure(new Response('',{status:429}),{code:'billing_hard_limit_reached'}).code,'billing');
 assert.equal(openaiFailure(new Response('',{status:429}),{code:'insufficient_quota'}).code,'billing');
 assert.equal(openaiFailure(new Response('',{status:429,headers:{'retry-after':'nonsense'}}),{}).retryAfterSeconds,60);
});
