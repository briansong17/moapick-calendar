import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('server-managed continuation only polls GET status; a closed/hidden page does not have to drive retries',async()=>{
 const requests=[],timers=[],status={};const document={hidden:false,getElementById:()=>status};
 const context={signedIn:true,document,navigator:{onLine:true},Date,
  api:async(path,body)=>{requests.push({path,body});return path.endsWith('/status')?{pending:false}:{pending:true,more:true,background:true};},
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},loadManagedEvents:async()=>{},history:async()=>{},connections:async()=>{}};
 const source=await readFile(new URL('../cloud/reconcile-ui.js',import.meta.url),'utf8');
 const reconcile=runInNewContext(source+'\nreconcileCalendar',context);
 await reconcile(true);assert.equal(requests.length,1);assert.match(status.textContent,/서버가.*이어서 처리/);
 document.hidden=true;await timers[0]();assert.equal(requests.length,1);
 document.hidden=false;await timers[0]();assert.equal(requests.length,2);assert.equal(requests[1].path,'/api/sync/status');assert.equal(requests[1].body,undefined);
 assert.match(status.textContent,/반영을 확인/);
});
