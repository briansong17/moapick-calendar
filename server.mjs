import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AppError, extract, inputHash, validateInput, validateReview } from './lib/extraction.mjs';
import { createStore } from './lib/store.mjs';
import { calendar } from './lib/calendar.mjs';

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
export function makeServer({ store, apiKey, model = 'gpt-5.4-mini', limit = 20, analyze = extract }) {
  let busy = false;
  const server = createServer(async (req, res) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    try {
      const expectedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!expectedHosts.includes(req.headers.host)) throw new AppError('허용되지 않은 주소입니다.', 403);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('다른 사이트의 요청은 허용되지 않습니다.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('다른 사이트의 요청은 허용되지 않습니다.', 403);
      const path = new URL(req.url, 'http://localhost').pathname;
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
        if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON 요청이 필요합니다.', 415);
        if (!apiKey) throw new AppError('서버에 OpenAI API 키가 설정되지 않았습니다.', 503);
        const input = validateInput(await body(req));
        const hash = inputHash(input, model), cached = store.cached(hash);
        if (cached) return send(200, { ...cached, cached: true });
        if (busy) throw new AppError('다른 이미지를 분석 중입니다. 완료 후 시도해 주세요.', 409);
        const { images, ...metadata } = input;
        const id = store.start(hash, { ...metadata, image_count: images.length, model }, limit);
        busy = true;
        try {
          const { result, usage } = await analyze(input, { apiKey, model });
          store.complete(id, result, usage);
          return send(200, { ...store.get(id), cached: false });
        } catch (error) {
          store.fail(id, error instanceof AppError ? error.message : '분석 중 오류가 발생했습니다.');
          throw error;
        } finally { busy = false; }
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
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(join(root, 'data'), { recursive: true });
  const store = createStore(join(root, 'data', 'events.sqlite'));
  const port = Number(process.env.PORT ?? 3080), limit = Number(process.env.DAILY_ANALYSIS_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 또는 DAILY_ANALYSIS_LIMIT 설정을 확인하세요.');
  const server = makeServer({ store, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.4-mini', limit });
  server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('서버 실행 실패: 포트가 사용 중인지 확인하세요.'); process.exitCode = 1; });
}
