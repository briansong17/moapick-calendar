import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCollector} from '../lib/collector.mjs';
import {createInstagram} from '../lib/instagram.mjs';
import {validateInput} from '../lib/extraction.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
test('자동 수집 20장 지원, 수동 업로드 3장 제한 유지',()=>{
  assert.equal(validateInput({images:Array(20).fill(image)},{maxImages:20}).images.length,20);
  assert.throws(()=>validateInput({images:Array(4).fill(image)}));
  assert.throws(()=>validateInput({images:Array(21).fill(image)},{maxImages:20}));
});
test('기존 4장 게시물 재처리, 영상 혼합과 누락 이미지의 부분 분석 차단',async()=>{
  const db=new DatabaseSync(':memory:');let calls=0;
  const photos=Array.from({length:4},(_,i)=>({id:String(i),media_type:'IMAGE',media_url:'https://x.fbcdn.net/a'}));
  const posts=[{id:'1',media_type:'CAROUSEL_ALBUM',children:{data:photos}},
    {id:'2',media_type:'CAROUSEL_ALBUM',children:{data:[...photos,{media_type:'VIDEO'}]}},
    {id:'3',media_type:'CAROUSEL_ALBUM',children:{data:photos,paging:{next:'more'}}}];
  const c=createCollector({db,instagram:{page:async()=>({posts,after:null}),download:async()=>image},analyze:async input=>{calls++;assert.equal(input.images.length,4);return {id:'analysis'};}});
  try{await c.add('school');await c.poll('school');assert.equal(calls,1);assert.equal(c.status().posts.filter(p=>p.status==='skipped').length,2);
    db.prepare("UPDATE instagram_posts SET status='skipped' WHERE id='1'").run();await c.poll('school');assert.equal(calls,2);
  }finally{c.stop();db.close();}
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
