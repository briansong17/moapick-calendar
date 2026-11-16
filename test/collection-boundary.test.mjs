import test from 'node:test';
import assert from 'node:assert/strict';
import {pastBoundary} from '../lib/collection-boundary.mjs';
const event=(date='2026-12-12')=>({title:'행사',kind:'event',start_date:date,end_date:date,needs_review:[]});
const result=events=>({events,warnings:[]});
test('과거 종료 기준: 미래 혼합·날짜 불명·경고·신청만 있는 글은 종료 근거 아님',()=>{
  const day='2026-11-12',past=event('2026-11-01');
  assert.equal(pastBoundary(result([past]),day),true);
  assert.equal(pastBoundary(result([past,event()]),day),false);
  assert.equal(pastBoundary(result([{...past,start_date:null}]),day),false);
  assert.equal(pastBoundary(result([{...past,kind:'registration'}]),day),false);
  assert.equal(pastBoundary({...result([past]),warnings:['연도 불명']},day),false);
  assert.equal(pastBoundary(result([event(day)]),day),false);
  assert.equal(pastBoundary(result([{...past,title:'2027년도 선거관리위원회 구성공고'}]),day),false);
});

