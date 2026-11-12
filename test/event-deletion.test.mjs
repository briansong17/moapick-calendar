import test from 'node:test';
import assert from 'node:assert/strict';
import {eventEntries,deletionIndices} from '../cloud/event-management.mjs';
import {calendarPayloads} from '../cloud/calendar-payload.mjs';
const event={title:'삭제 테스트',kind:'event',start_date:'2026-11-13',end_date:'2026-11-13',start_time:null,end_time:null,timezone:'Asia/Seoul',location:null,description:'',booking_url:null,evidence:[],needs_review:[]};
const row={id:'a',metadata:{source_url:''},result:{events:[event,event,event],warnings:[]}};
test('개별·선택·전체 삭제는 안정적인 원본 번호를 유지하고 검토 상태를 바꾸지 않는다',()=>{
 for(const indices of [[1],[0,2],[0,1,2]]){
 const deleted={...row,deleted_indices:deletionIndices({confirmed:true,indices},row)};
 assert.deepEqual(eventEntries(deleted).map(x=>x.index),[0,1,2].filter(i=>!indices.includes(i)));
 const remaining=calendarPayloads('u',deleted,'https://test.example');assert.equal(remaining.payloads.length,3-indices.length);assert.equal(remaining.reviewed,false);
 for(const p of remaining.payloads)assert.ok(p.summary.startsWith('(검토 필요)'));
 }
 const reviewed={...row,reviewed:[event,event],source_indices:[2,0],deleted_indices:[2]};
 assert.deepEqual(eventEntries(reviewed).map(x=>x.index),[0]);
 assert.throws(()=>deletionIndices({confirmed:true,indices:[-1]},row));assert.throws(()=>deletionIndices({confirmed:false,indices:[0]},row));
});
