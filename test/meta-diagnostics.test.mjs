import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstagram} from '../lib/instagram.mjs';
import {tracedRequest,trace,traceSnapshot,diagnosticFailureCode} from '../cloud/diagnostics.mjs';

const config={token:'TOKEN-SENTINEL-PRIVATE',ig_id:'123456789012345',version:'v27.0'};
const vault={get:()=>config,set:()=>{}};

test('Meta access block is distinct from target-account eligibility; logs contain only safe structured data',async()=>{
  await tracedRequest(async()=>{
    const ig=createInstagram({vault,onDiagnostic:trace,fetchImpl:async()=>Response.json({error:{code:200,error_subcode:5258005,type:'OAuthException',message:'TOKEN-SENTINEL-PRIVATE account-secret@example.test https://secret.test'}},{status:400})});
    await assert.rejects(ig.page('ssu_statistics'),error=>{
      assert.equal(error.status,502);
      assert.equal(diagnosticFailureCode(error.message),'meta_access_blocked');
      assert.match(error.message,/200\/5258005/);
      assert.doesNotMatch(error.message,/개인 계정|TOKEN-SENTINEL|account-secret/);
      return true;
    });
    const snapshot=traceSnapshot();
    const failure=snapshot.steps.find(step=>step.stage==='meta.http.failed');
    assert.equal(failure.status,400);assert.equal(failure.code,200);assert.equal(failure.subcode,5258005);assert.equal(failure.category,'meta_access_blocked');
    assert.doesNotMatch(JSON.stringify(snapshot),/TOKEN-SENTINEL|account-secret|https:|123456789012345|ssu_statistics/);
  });
});

test('a different Meta permission error is not misclassified as the confirmed API access block',async()=>{
  const steps=[];
  const ig=createInstagram({vault,onDiagnostic:(stage,details)=>steps.push({stage,...details}),fetchImpl:async()=>Response.json({error:{code:200,error_subcode:42,message:'private-provider-message'}},{status:400})});
  await assert.rejects(ig.page('school'),error=>error.status===502&&!error.message.includes('5258005')&&!error.message.includes('private-provider-message'));
  assert.equal(steps.at(-1).category,'meta_permission');
});

test('successful Meta requests and network failures have separate safe stages',async()=>{
  const steps=[];
  const ig=createInstagram({vault,onDiagnostic:(stage,details)=>steps.push({stage,...details}),fetchImpl:async()=>Response.json({business_discovery:{id:'11111',username:'school',media:{data:[]}}})});
  assert.deepEqual((await ig.page('school')).posts,[]);
  assert.deepEqual(steps.map(step=>step.stage),['meta.http.start','meta.http.complete']);
  const failing=createInstagram({vault,onDiagnostic:(stage,details)=>steps.push({stage,...details}),fetchImpl:async()=>{throw new Error('network-secret');}});
  await assert.rejects(failing.page('school'),error=>error.status===502&&!error.message.includes('network-secret'));
  assert.equal(steps.at(-1).category,'meta_network');
});
