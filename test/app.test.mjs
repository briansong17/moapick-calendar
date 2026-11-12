import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInput, normalizeResult, validateReview, extract } from '../lib/extraction.mjs';
import { createStore } from '../lib/store.mjs';
import { calendar } from '../lib/calendar.mjs';
import { makeServer } from '../server.mjs';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const input = { images: [image], caption: '', account: '', source_url: '', posted_at: '' };
const event = () => ({ title: '겨울 축제', kind: 'event', start_date: '2026-12-12', end_date: '2026-12-13', start_time: null, end_time: null, timezone: 'Asia/Seoul', location: '서울', description: '공연', booking_url: null, evidence: ['2026.12.12~13'], needs_review: [] });
const result = () => ({ summary: '행사 일정', warnings: [], events: [event()] });

test('입력 제한: 유효 이미지, 위장 파일, 날짜, 외부 주소', () => {
  assert.equal(validateInput(input).images.length, 1);
  assert.throws(() => validateInput({ ...input, images: ['data:image/png;base64,YWJj'] }));
  assert.throws(() => validateInput({ ...input, posted_at: '2026-02-30' }));
  assert.throws(() => validateInput({ ...input, source_url: 'https://instagram.com.evil.test/p/x' }));
  assert.throws(() => validateInput({ ...input, images: [image, image, image, image] }));
});
test('연도 추측 없이 검토하고 잘못된 날짜는 제거', () => {
  const r = result(); r.events[0].start_date = '2026-02-30'; r.events[0].timezone = null;
  const normalized = normalizeResult(r);
  assert.equal(normalized.events[0].start_date, null);
  assert.ok(normalized.events[0].needs_review.length >= 2);
  assert.throws(() => validateReview(normalized.events));
});
test('시간 역전, 불명 시간대 및 미완성 종료시간 저장 방지', () => {
  assert.throws(() => validateReview([{ ...event(), timezone: null }]));
  assert.throws(() => validateReview([{ ...event(), start_time: '16:00', end_time: '15:00', end_date: '2026-12-12' }]));
  assert.throws(() => validateReview([{ ...event(), start_time: '16:00' }]));
});
test('OpenAI 구조화 요청 및 성공 응답 처리', async () => {
  const out = await extract(input, { apiKey: 'fake', model: 'mock', fetchImpl: async (url, options) => {
    const b = JSON.parse(options.body);
    assert.equal(b.store, false); assert.equal(b.text.format.strict, true);
    assert.equal(b.input[0].content[1].type, 'input_image');
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result()) }] }], usage: { total_tokens: 123 } });
  } });
  assert.equal(out.result.events[0].title, '겨울 축제');
});
test('거절·불완전 출력·잔액 부족과 민감정보 오류 노출 방지', async () => {
  for (const data of [{ status: 'incomplete' }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }]) {
    await assert.rejects(extract(input, { fetchImpl: async () => Response.json(data) }));
  }
  await assert.rejects(extract(input, { fetchImpl: async () => Response.json({ error: { code: 'insufficient_quota', message: 'SECRET' } }, { status: 429 }) }), e => e.status === 402 && !e.message.includes('SECRET'));
  await assert.rejects(extract(input, { fetchImpl: async () => { throw new Error('SECRET'); } }), e => !e.message.includes('SECRET'));
});
test('캘린더 종일 종료일, 시간대 변환, 주입 방지', () => {
  const record = { id: 'test', created_at: '2026-11-12T00:00:00Z', metadata: {}, reviewed: [event()] };
  assert.match(calendar(record), /DTEND;VALUE=DATE:20261214/);
  record.reviewed = [{ ...event(), title: '제목\nBEGIN:VEVENT', start_time: '18:00', end_time: '20:00', end_date: null }];
  const text = calendar(record);
  assert.match(text, /DTSTART:20261212T090000Z/);
  assert.equal(text.match(/\r\nBEGIN:VEVENT/g).length, 1);
});
test('재시작 복구 및 일일 한도 유지', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moa-test-')); const path = join(dir, 'test.sqlite');
  try {
    let store = createStore(path); const id = store.start('hash', {}, 1); store.db.close();
    store = createStore(path);
    assert.equal(store.get(id).status, 'interrupted');
    assert.throws(() => store.start('new', {}, 1), e => e.status === 429);
    store.db.close();
  } finally { rmSync(dir, { recursive: true }); }
});
test('HTTP: 중복 분석 방지, 저장 확인, 한도, 정적파일 보호', async () => {
  const store = createStore(':memory:'); let calls = 0;
  const server = makeServer({ store, apiKey: 'fake', limit: 1, analyze: async () => { calls++; return { result: result(), usage: {} }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie:cookie, ...headers }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/.env.local')).status, 404);
    assert.equal((await post('/api/analyze', input, { Origin: 'https://evil.test' })).status, 403);
    const signup=await post('/api/auth/register',{login:'tester',password:'test-password-long'}); cookie=signup.headers.get('set-cookie').split(';')[0];
    const first = await (await post('/api/analyze', input)).json();
    assert.equal((await (await post('/api/analyze', input)).json()).cached, true); assert.equal(calls, 1);
    assert.equal((await post('/api/analyze', { ...input, caption: 'changed' })).status, 429);
    assert.equal((await post(`/api/analyses/${first.id}/review`, { events: result().events })).status, 400);
    assert.equal((await post(`/api/analyses/${first.id}/review`, { events: result().events, confirmed: true })).status, 200);
    assert.match(await (await fetch(`${base}/api/analyses/${first.id}/calendar.ics`,{headers:{Cookie:cookie}})).text(), /BEGIN:VCALENDAR/);
    assert.equal(store.get(first.id).metadata.images, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); store.db.close(); }
});
