import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../cloud/workspace-ui.js',import.meta.url),'utf8');
test('ordinary members retain support and history while operator tools stay hidden, including direct navigation',()=>{
 const panels=[{hidden:true},{hidden:true}],opened=[],body={dataset:{}};
 const {bind,allowed}=runInNewContext(source+'\n({bind:bindWorkspace,allowed:workspaceViewAllowed})',{
  document:{body,querySelectorAll:()=>panels},location:{hash:'#testing'},openView:view=>opened.push(view)
 });
 const member={id:'member',operations:false,memberSchedules:false};bind(member);
 assert.equal(body.dataset.session,'member');assert.ok(panels.every(p=>p.hidden));assert.deepEqual(opened,['events']);
 for(const view of ['events','subscriptions','upload','history','settings','diagnostics'])assert.equal(allowed(view,member),true);
 assert.equal(allowed('members',member),false);assert.equal(allowed('testing',member),false);
 bind({...member,operations:true});assert.ok(panels.every(p=>!p.hidden));assert.equal(allowed('members',{operations:true}),false);
 assert.equal(allowed('members',{memberSchedules:true}),true);
 bind(null);assert.equal(body.dataset.session,'guest');assert.ok(panels.every(p=>p.hidden));
});
