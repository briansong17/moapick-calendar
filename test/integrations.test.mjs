import test from 'node:test';
import assert from 'node:assert/strict';
import {googleEvent} from '../lib/google.mjs';
import {contentHash,safeMediaURL,createInstagram} from '../lib/instagram.mjs';
const event = () => ({ title: '행사', kind: 'event', start_date: '2026-12-12', end_date: '2026-12-13', start_time: null, end_time: null, timezone: 'Asia/Seoul', location: null, description: '', booking_url: null, evidence: [], needs_review: [] });
function memoryVault() { const data = {}; return { get: k => data[k], set: (k, v) => { data[k] = v; } }; }

test('Google 날짜 종료 경계와 누락 종료시간 차단', () => {
  assert.deepEqual(googleEvent(event(), 'abcde').end, { date: '2026-12-14' });
  assert.throws(() => googleEvent({ ...event(), start_time: '14:00', end_date: null }, 'abcde'));
});
test('Meta CDN 제한과 URL 서명 변경시 AI 재분석 방지', () => {
  assert.throws(() => safeMediaURL('http://127.0.0.1/'));
  assert.throws(() => safeMediaURL('https://fbcdn.net.evil.test/a.jpg'));
  assert.equal(safeMediaURL('https://scontent.example.fbcdn.net/a.jpg').protocol, 'https:');
  assert.equal(contentHash({ id: '1', caption: 'a', media_url: '?signed=1' }), contentHash({ id: '1', caption: 'a', media_url: '?signed=2' }));
});
test('Meta 권한 오류는 계정 유형으로 단정하거나 토큰 노출하지 않음', async () => {
  const vault = memoryVault(); vault.set('meta', { token: 'fake-secret', ig_id: '12345', version: 'v24.0' });
  const ig = createInstagram({ vault, fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.has('access_token'), false); assert.ok(options.headers.Authorization);
    return Response.json({ error: { code: 100, message: 'fake-secret' } }, { status: 400 });
  } });
  await assert.rejects(ig.page('account'), e => !e.message.includes('fake-secret') && e.message.includes('판단할 수 없습니다'));
});
