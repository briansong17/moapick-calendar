import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../cloud/test-users-ui.js',import.meta.url),'utf8');
const message=runInNewContext(source+'\ncollectionResultMessage');
test('collection messages distinguish processed posts from eligible skips and backoff',()=>{
 assert.match(message({processed:true,count:1}),/1개.*확인/);
 const skipped=message({processed:false,reason:'not_due',deferred:[{nextDue:'2099-01-01T00:00:00Z',failed:false}]});
 assert.match(skipped,/수집하지 않았습니다/);assert.match(skipped,/2099/);assert.doesNotMatch(skipped,/수집이 끝|확인했습니다/);
 assert.match(message({processed:false,reason:'not_due',deferred:[{failed:true}]}),/오류로 대기/);
 assert.match(message({processed:false,reason:'no_enabled_subscription'}),/활성 구독이 없어/);
});
