import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstagram} from '../lib/instagram.mjs';
import {validateInput} from '../lib/extraction.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';

test('자동 수집 20장 지원, 수동 업로드 3장 제한 유지',()=>{
  assert.equal(validateInput({images:Array(20).fill(image)},{maxImages:20}).images.length,20);
  assert.throws(()=>validateInput({images:Array(4).fill(image)}));
  assert.throws(()=>validateInput({images:Array(21).fill(image)},{maxImages:20}));
});
test('Meta 만료 상태 저장 및 재연결 성공 시 해제, 비밀정보 미노출',async()=>{
  const data={meta:{token:'secret-sentinel',ig_id:'12345',version:'v27.0'}};
  const vault={get:k=>data[k],set:(k,v)=>data[k]=v};let expired=true;
  const ig=createInstagram({vault,fetchImpl:async()=>expired?Response.json({error:{code:190,message:'secret-sentinel'}},{status:400}):Response.json({id:'12345',username:'school'})});
  await assert.rejects(ig.page('school'),e=>e.status===401&&!e.message.includes('secret-sentinel'));
  assert.equal(ig.status().reconnectRequired,true);expired=false;
  await ig.configure({token:'long-test-token-not-real',ig_id:'12345',version:'v27.0'});
  assert.equal(ig.status().reconnectRequired,false);
});
