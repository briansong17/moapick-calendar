import test from 'node:test';import assert from 'node:assert/strict';
import {trace,tracedRequest,traceSnapshot,traceDatabase} from '../cloud/diagnostics.mjs';
test('진단은 토큰·본문·URL을 제외하고 동시 요청을 분리한다',async()=>{
 const run=id=>tracedRequest(async()=>{trace('request.received',{analysisId:id,token:'SECRET',body:'caption',url:'https://example.test/?token=SECRET'});await new Promise(r=>setTimeout(r,5));trace('request.complete',{status:200});return traceSnapshot();});
 const [a,b]=await Promise.all([run('a'),run('b')]);assert.notEqual(a.requestId,b.requestId);assert.equal(a.steps[0].analysisId,'a');assert.equal(b.steps[0].analysisId,'b');assert.equal(a.steps.length,2);assert.doesNotMatch(JSON.stringify([a,b]),/SECRET|caption|https:/);
});
test('진단 저장소 오류 로그는 원래 오류 메시지와 데이터에 접근하지 않는다',async()=>{
 await tracedRequest(async()=>{const db=traceDatabase({admin:async()=>{throw Object.assign(new Error('SECRET-token'),{status:503});}});await assert.rejects(db.admin('moa_analyses',{id:'private-id'},{body:{token:'SECRET-token'}}));const s=JSON.stringify(traceSnapshot());assert.match(s,/database.failed/);assert.doesNotMatch(s,/SECRET|private-id/);});
});
