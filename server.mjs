import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AppError, extract, inputHash, validateInput, validateReview } from './lib/extraction.mjs';
import { createStore } from './lib/store.mjs';
import { calendar } from './lib/calendar.mjs';
import { createVault } from './lib/vault.mjs';
import { createGoogle } from './lib/google.mjs';
import { createInstagram, createCollector } from './lib/instagram.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 13 * 1024 * 1024) throw new AppError('업로드 용량이 너무 큽니다.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('요청 형식이 올바르지 않습니다.'); }
}
export function makeServer({ store, apiKey, model = 'gpt-5.4-mini', limit = 20, analyze = extract, vault }) {
  let busy = false;
  async function analyzeInput(raw) {
    if (!apiKey) throw new AppError('서버에 OpenAI API 키가 설정되지 않았습니다.', 503);
    const input = validateInput(raw), hash = inputHash(input, model), cached = store.cached(hash);
    if (cached) return { ...cached, cached: true };
    if (busy) throw new AppError('다른 이미지를 분석 중입니다. 완료 후 시도해 주세요.', 409);
    const { images, ...metadata } = input;
    const id = store.start(hash, { ...metadata, image_count: images.length, model }, limit);
    busy = true;
    try {
      const { result, usage } = await analyze(input, { apiKey, model });
      store.complete(id, result, usage); return { ...store.get(id), cached: false };
    } catch (e) { store.fail(id, e instanceof AppError ? e.message : '분석 중 오류가 발생했습니다.'); throw e; }
    finally { busy = false; }
  }
  const google = vault && createGoogle({ vault, db: store.db });
  const instagram = vault && createInstagram({ vault });
  const collector = vault && createCollector({ db: store.db, instagram, analyze: analyzeInput });
  const server = createServer(async (req, res) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      const expectedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!expectedHosts.includes(req.headers.host)) throw new AppError('허용되지 않은 주소입니다.', 403);
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      const oauthCallback = req.method === 'GET' && path === '/oauth/google/callback';
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('다른 사이트의 요청은 허용되지 않습니다.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site' && !oauthCallback) throw new AppError('다른 사이트의 요청은 허용되지 않습니다.', 403);
      if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON 요청이 필요합니다.', 415);
      if (vault) {
        if (req.method === 'GET' && path === '/api/integrations') return send(200, { google: google.status(), meta: instagram.status(), collector: collector.status() });
        if (oauthCallback) {
          const binding = /(?:^|;\s*)moa_oauth=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
          try {
            await google.callback(url.searchParams, binding);
            res.writeHead(303, { Location: '/?google=connected', 'Set-Cookie': 'moa_oauth=; HttpOnly; SameSite=Lax; Path=/oauth/google; Max-Age=0', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end();
          } catch (e) { res.setHeader('Set-Cookie', 'moa_oauth=; HttpOnly; SameSite=Lax; Path=/oauth/google; Max-Age=0'); throw e; }
        }
        if (req.method === 'POST' && path === '/api/google/config') { google.configure(await body(req)); return send(200, { saved: true }); }
        if (req.method === 'POST' && path === '/api/google/connect') {
          if (req.headers.host !== '127.0.0.1:3080') throw new AppError('Google 연결은 http://127.0.0.1:3080 에서 진행해 주세요.');
          const { binding, url } = await google.begin();
          res.setHeader('Set-Cookie', `moa_oauth=${binding}; HttpOnly; SameSite=Lax; Path=/oauth/google; Max-Age=600`);
          return send(200, { url });
        }
        if (req.method === 'POST' && path === '/api/google/calendar') return send(200, await google.createCalendar());
        if (req.method === 'POST' && path === '/api/meta/config') { await instagram.configure(await body(req)); return send(200, { saved: true }); }
        if (req.method === 'POST' && path === '/api/meta/accounts') { await collector.add((await body(req)).username); return send(200, collector.status()); }
        if (req.method === 'POST' && path === '/api/meta/enable') { const b = await body(req); collector.enable(b.username, b.enabled); return send(200, collector.status()); }
        if (req.method === 'POST' && path === '/api/meta/poll') { await collector.poll((await body(req)).username); return send(200, collector.status()); }
        const publish = /^\/api\/analyses\/([0-9a-f-]+)\/google$/.exec(path);
        if (req.method === 'POST' && publish) {
          const row = store.get(publish[1]); if (!row) throw new AppError('분석 기록을 찾을 수 없습니다.', 404);
          if ((await body(req)).confirmed !== true) throw new AppError('Google 등록 확인이 필요합니다.');
          return send(200, await google.publish(row));
        }
      }
      if (req.method === 'GET' && path === '/api/status') return send(200, { configured: !!apiKey, model, count: store.count(), limit, busy });
      if (req.method === 'GET' && path === '/api/analyses') return send(200, store.list());
      const match = /^\/api\/analyses\/([0-9a-f-]+)(\/review|\/calendar.ics)?$/.exec(path);
      if (match) {
        const row = store.get(match[1]);
        if (!row) throw new AppError('분석 기록을 찾을 수 없습니다.', 404);
        if (req.method === 'GET' && !match[2]) return send(200, row);
        if (req.method === 'GET' && match[2] === '/calendar.ics') {
          if (!row.reviewed) throw new AppError('먼저 일정을 확인하고 저장해 주세요.');
          res.setHeader('Content-Disposition', 'attachment; filename="events.ics"');
          return send(200, calendar(row), 'text/calendar; charset=utf-8');
        }
        if (req.method === 'POST' && match[2] === '/review') {
          if (row.status !== 'complete') throw new AppError('완료된 분석만 검토할 수 있습니다.');
          const input = await body(req);
          if (input.confirmed !== true) throw new AppError('원문과 비교 확인 후 저장해 주세요.');
          store.review(row.id, validateReview(input.events));
          return send(200, store.get(row.id));
        }
      }
      if (req.method === 'POST' && path === '/api/analyze') {
        return send(200, await analyzeInput(await body(req)));
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[path]) {
        const [name, type] = assets[path];
        return send(200, await readFile(join(root, 'public', name)), `${type}; charset=utf-8`);
      }
      throw new AppError('페이지를 찾을 수 없습니다.', 404);
    } catch (error) {
      send(error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : '서버 오류가 발생했습니다. 비밀정보는 기록하지 않았습니다.' });
    }
  });
  server.requestTimeout = 150000;
  server.on('listening', () => collector?.start());
  server.on('close', () => collector?.stop());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(join(root, 'data'), { recursive: true });
  const store = createStore(join(root, 'data', 'events.sqlite'));
  const port = Number(process.env.PORT ?? 3080), limit = Number(process.env.DAILY_ANALYSIS_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 또는 DAILY_ANALYSIS_LIMIT 설정을 확인하세요.');
  const vault = createVault(join(root, 'data'));
  const server = makeServer({ store, vault, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.4-mini', limit });
  server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('서버 실행 실패: 포트가 사용 중인지 확인하세요.'); process.exitCode = 1; });
}
