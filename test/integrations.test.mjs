import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from '../lib/vault.mjs';
import { createGoogle, googleEvent, GOOGLE_REDIRECT, GOOGLE_SCOPE } from '../lib/google.mjs';
import { createCollector, contentHash, safeMediaURL, createInstagram } from '../lib/instagram.mjs';
import { AppError } from '../lib/extraction.mjs';
const event = () => ({ title: '행사', kind: 'event', start_date: '2026-12-12', end_date: '2026-12-13', start_time: null, end_time: null, timezone: 'Asia/Seoul', location: null, description: '', booking_url: null, evidence: [], needs_review: [] });
function memoryVault() { const data = {}; return { get: k => data[k], set: (k, v) => { data[k] = v; } }; }

test('연동 비밀정보 암호화 저장 및 재개방', () => {
  const dir = mkdtempSync(join(tmpdir(), 'moa-vault-'));
  try {
    const vault = createVault(dir); vault.set('token', 'secret-sentinel');
    assert.equal(createVault(dir).get('token'), 'secret-sentinel');
    assert.equal(readFileSync(join(dir, 'integrations.enc')).includes('secret-sentinel'), false);
  } finally { rmSync(dir, { recursive: true }); }
});
test('Google 날짜 종료 경계와 누락 종료시간 차단', () => {
  assert.deepEqual(googleEvent(event(), 'abcde').end, { date: '2026-12-14' });
  assert.throws(() => googleEvent({ ...event(), start_time: '14:00', end_date: null }, 'abcde'));
});
test('Google OAuth state/cookie, 범위, 재연결 캘린더 보존, 등록 중복 방지', async () => {
  const vault = memoryVault(), db = new DatabaseSync(':memory:'); let inserts = 0;
  const createdEvents = new Map(); let failAfterCreate = false;
  class Mock extends EventEmitter {
    setCredentials() {}
    async generateCodeVerifierAsync() { return { codeVerifier: 'verifier', codeChallenge: 'challenge' }; }
    generateAuthUrl(options) { assert.deepEqual(options.scope, [GOOGLE_SCOPE]); return `https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`; }
    async getToken(options) { assert.equal(options.codeVerifier, 'verifier'); return { tokens: { refresh_token: 'fake', scope: GOOGLE_SCOPE } }; }
    async request(options) {
      if (options.url.endsWith('/calendars') && options.method === 'POST') return { data: { id: 'calendar1', summary: '모아' } };
      if (options.url.endsWith('/calendars/calendar1') && options.method === 'GET') return { data: { id: 'calendar1' } };
      if (options.method === 'POST') {
        if (createdEvents.has(options.data.id)) throw { response: { status: 409 } };
        inserts++; createdEvents.set(options.data.id, { htmlLink: 'https://calendar.google.com/event' });
        if (failAfterCreate) { failAfterCreate = false; throw new Error('network disconnect after commit'); }
        return { data: createdEvents.get(options.data.id) };
      }
      return { data: createdEvents.get(options.url.split('/').at(-1)) };
    }
  }
  const google = createGoogle({ vault, db, clientFactory: () => new Mock() });
  try {
    google.configure({ web: { client_id: 'fake.apps.googleusercontent.com', client_secret: 'fake', redirect_uris: [GOOGLE_REDIRECT] } });
    let flow = await google.begin(), params = new URL(flow.url).searchParams; params.set('code', 'fake');
    await assert.rejects(google.callback(params, 'wrong-cookie'));
    await google.callback(params, flow.binding);
    await assert.rejects(google.callback(params, flow.binding));
    await google.createCalendar();
    const record = { id: 'record1', metadata: {}, reviewed: [event()] };
    failAfterCreate = true;
    await assert.rejects(google.publish(record));
    await google.publish(record); // Recover a committed insert through deterministic ID / HTTP 409.
    assert.equal(inserts, 1);
    assert.equal((await google.publish(record)).reused, true);
    record.reviewed[0].title = '변경';
    await assert.rejects(google.publish(record), e => e.status === 409);
    flow = await google.begin(); params = new URL(flow.url).searchParams; params.set('code', 'fake');
    await google.callback(params, flow.binding);
    assert.equal(google.status().calendar, '모아');
  } finally { db.close(); }
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
test('주기 수집: 중복 방지, 캡션 변경, 한도 대기, 영상 건너뛰기', async () => {
  const db = new DatabaseSync(':memory:'); let caption = '원본', calls = 0, capped = false;
  const ig = {
    async page() { return { posts: [{ id: '12345', media_type: 'IMAGE', caption, media_url: 'https://x.fbcdn.net/a.jpg' }, { id: '67890', media_type: 'VIDEO' }], after: null }; },
    async download() { return 'data:image/png;base64,test'; },
  };
  const c = createCollector({ db, instagram: ig, analyze: async () => { if (capped) throw new AppError('cap', 429); calls++; return { id: `analysis${calls}` }; } });
  try {
    await c.add('test'); await c.poll('test'); await c.poll('test');
    assert.equal(calls, 1); assert.equal(c.status().posts.find(p => p.id === '67890').status, 'skipped');
    caption = '변경'; capped = true; await c.poll('test');
    assert.equal(c.status().posts.find(p => p.id === '12345').attempts, 0);
    capped = false; await c.poll('test'); assert.equal(calls, 2);
    assert.equal(c.status().accounts[0].enabled, 0);
  } finally { c.stop(); db.close(); }
});
