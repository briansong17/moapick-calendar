import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput,normalizeResult,validateReview,extract} from '../lib/extraction.mjs';
import {calendar} from '../lib/calendar.mjs';
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
