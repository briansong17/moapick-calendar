import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServerMonitor} from '../lib/server-monitor.mjs';

test('monitor counts completed/aborted requests once and redacts URLs', () => {
 const logs=[];let time=0;
 const monitor=createServerMonitor({state:()=>({SQLite:'연결 정상'}),write:s=>logs.push(s),now:()=>time});
 const response=new EventEmitter();response.statusCode=200;response.writableFinished=true;
 monitor.track({method:'POST',url:'/api/analyze?token=SECRET',body:'PRIVATE'},response);
 time=100;response.emit('finish');response.emit('close');
 const aborted=new EventEmitter();monitor.track({method:'GET',url:'/private/SECRET'},aborted);aborted.emit('close');
 monitor.change('이미지 분석 저장 완료');monitor.report();
 const output=logs.join('\n');
 assert.match(output,/요청 완료 2건/);assert.match(output,/응답 중단 1건/);
 assert.match(output,/POST \/api\/analyze → 200 1건/);assert.match(output,/이미지 분석 저장 완료/);
 assert.doesNotMatch(output,/SECRET|PRIVATE/);
 monitor.report();assert.match(logs.at(-1),/요청 완료 0건/);
});

test('heartbeat runs while idle and stops cleanly; state failure is contained', async () => {
 const logs=[];
 const monitor=createServerMonitor({state:()=>{throw Error('SECRET');},write:s=>logs.push(s),intervalMs:10});
 monitor.start();
 await new Promise(resolve=>setTimeout(resolve,55));
 monitor.stop();const count=logs.length;
 assert.ok(logs.filter(s=>s.includes('[서버 상태')).length>=2);
 assert.match(logs.join('\n'),/상태 조회 실패/);assert.doesNotMatch(logs.join('\n'),/SECRET/);
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(logs.length,count);
});
