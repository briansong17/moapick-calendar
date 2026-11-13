import {createServerMonitor} from './lib/server-monitor.mjs';
import { createAccounts, sessionCookie } from './lib/accounts.mjs';
import { accountName } from './lib/instagram.mjs';
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
export function makeServer({ store, apiKey, model = 'gpt-5.4-mini', limit = 20, analyze = extract, vault, instagramClient, monitoring = false, monitorOptions = {} }) {
  const accounts = createAccounts(store.db);
  let busy = false;
  async function analyzeInput(raw, user=null) {
    if (!apiKey) throw new AppError('서버에 OpenAI API 키가 설정되지 않았습니다.', 503);
    const input = validateInput(raw, {maxImages:user ? 3 : 20}), hash = inputHash(input, model + ':' + (user?.id ?? 'public-instagram')), cached = store.cached(hash);
    if (cached) {monitor?.change('기존 분석 재사용');return { ...cached, cached: true };}
    if (busy) throw new AppError('다른 이미지를 분석 중입니다. 완료 후 시도해 주세요.', 409);
    const { images, ...metadata } = input;
    const id = store.start(hash, { ...metadata, image_count: images.length, model }, limit);
    if(user) accounts.own(id,user);
    busy = true;
    try {
      const { result, usage } = await analyze(input, { apiKey, model });
      store.complete(id, result, usage);monitor?.change('이미지 분석 저장 완료'); return { ...store.get(id), cached: false };
    } catch (e) { monitor?.change('이미지 분석 실패');store.fail(id, e instanceof AppError ? e.message : '분석 중 오류가 발생했습니다.'); throw e; }
    finally { busy = false; }
  }
  const googleClients = new Map();
  const googleFor = user => {
    if(!vault)return null;
    if(!googleClients.has(user.id)) {
      const key = k => k==='googleClient' || user.admin ? k : `user:${user.id}:${k}`;
      googleClients.set(user.id, createGoogle({vault:{get:k=>vault.get(key(k)),set:(k,v)=>vault.set(key(k),v)},db:store.db}));
    }
    return googleClients.get(user.id);
  };
  const instagram = vault && (instagramClient ?? createInstagram({ vault }));
  const collector = vault && createCollector({ db: store.db, instagram, analyze: analyzeInput });
  const subscribed = (user,name) => !!store.db.prepare('SELECT 1 FROM subscriptions WHERE user_id=? AND username=?').get(user.id,name);
  const syncEnabled = name => collector.enable(name,!!store.db.prepare('SELECT 1 FROM subscriptions WHERE username=? AND enabled=1').get(name));
  const collectorStatus = user => {
    const state=collector.status();
    state.accounts=state.accounts.filter(a=>subscribed(user,a.username)).map(a=>({...a,enabled:store.db.prepare('SELECT enabled FROM subscriptions WHERE user_id=? AND username=?').get(user.id,a.username).enabled}));
    state.posts=state.posts.filter(p=>subscribed(user,p.username)); return state;
  };
  const monitor=monitoring?createServerMonitor({...monitorOptions,state:()=>{
    store.db.prepare('SELECT 1').get();
    const rows=store.db.prepare('SELECT status,COUNT(*) AS n FROM analyses GROUP BY status').all();
    const count=status=>rows.find(r=>r.status===status)?.n??0;
    const values={'SQLite':'연결 정상','AI 분석':busy?'진행 중':'대기','오늘 분석 사용량':store.count()+'/'+limit,'분석 완료':count('complete'),'분석 실패':count('failed'),'중단된 분석':count('interrupted'),'분석 중':count('running')};
    if(collector){const c=collector.status();values['Instagram 수집']=c.busy?'진행 중':'대기';values['수집 활성 계정']=c.accounts.filter(a=>a.enabled).length;values['수집 오류 계정']=c.accounts.filter(a=>a.error).length;values['최근 게시물 완료']=c.posts.filter(p=>p.status==='complete').length;values['최근 게시물 대기']=c.posts.filter(p=>p.status==='pending').length;values['최근 게시물 실패']=c.posts.filter(p=>p.status==='failed').length;}
    return values;
  }}):null;
  const server = createServer(async (req, res) => {
    monitor?.track(req,res);
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
      const user=accounts.user(req.headers.cookie);
      if(path==='/api/auth/me' && req.method==='GET') return send(200,{user,setup:accounts.empty()});
      if(['/api/auth/register','/api/auth/login'].includes(path) && req.method==='POST') {
        const result=await accounts.authenticate(await body(req),path.endsWith('register'),req.socket.remoteAddress);
        accounts.logout(req.headers.cookie);
        res.setHeader('Set-Cookie',sessionCookie(result.token)); return send(200,{user:result.user});
      }
      if(path==='/api/auth/logout' && req.method==='POST') {accounts.logout(req.headers.cookie);res.setHeader('Set-Cookie',sessionCookie(''));return send(200,{ok:true});}
      if((path.startsWith('/api/')||oauthCallback)&&!user)throw new AppError('로그인해 주세요.',401);
      const google=user&&googleFor(user);
      const visible = id => { const row=store.get(id); if(!accounts.accessible(row,user))throw new AppError('분석 기록을 찾을 수 없습니다.',404);return accounts.decorate(row,user); };
      if(['/api/google/config','/api/meta/config'].includes(path)&&!user?.admin)throw new AppError('관리자만 연결 설정을 변경할 수 있습니다.',403);
      if (vault) {
        if (req.method === 'GET' && path === '/api/integrations') return send(200, { google: google.status(), meta: instagram.status(), collector: collectorStatus(user) });
        if (oauthCallback) {
          const binding = /(?:^|;\s*)moa_oauth=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
          try {
            await google.callback(url.searchParams, binding);
            // Commit a same-origin document before returning to the app: a 303
            // preserves cross-site Fetch Metadata across the OAuth redirect chain.
            res.setHeader('Set-Cookie', 'moa_oauth=; HttpOnly; SameSite=Lax; Path=/oauth/google; Max-Age=0');
            return send(200, '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Google 연결 완료</title><h1>Google 계정을 연결했습니다.</h1><p><a href="/?google=connected">모아로 돌아가기</a></p></html>', 'text/html; charset=utf-8');
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
        if (req.method === 'POST' && path === '/api/meta/accounts') {
          const name=accountName((await body(req)).username);
          if(!subscribed(user,name) && store.db.prepare('SELECT count(*) n FROM subscriptions WHERE user_id=?').get(user.id).n>=20)throw new AppError('구독은 최대 20개까지 가능합니다.');
          await collector.add(name);
          if(!subscribed(user,name) && store.db.prepare('SELECT count(*) n FROM subscriptions WHERE user_id=?').get(user.id).n>=20)throw new AppError('구독은 최대 20개까지 가능합니다.');
          store.db.prepare('INSERT OR IGNORE INTO subscriptions(user_id,username) VALUES(?,?)').run(user.id,name);syncEnabled(name);
          return send(200,collectorStatus(user));
        }
        if(req.method==='POST' && path==='/api/meta/unsubscribe') {
          const name=accountName((await body(req)).username);
          store.db.prepare('DELETE FROM subscriptions WHERE user_id=? AND username=?').run(user.id,name);syncEnabled(name);
          return send(200,collectorStatus(user));
        }
        if (req.method === 'POST' && path === '/api/meta/enable') { const b = await body(req), name=accountName(b.username); if(!subscribed(user,name))throw new AppError('구독을 찾을 수 없습니다.',404); if(typeof b.enabled!=='boolean')throw new AppError('활성화 여부를 확인하세요.'); store.db.prepare('UPDATE subscriptions SET enabled=? WHERE user_id=? AND username=?').run(Number(b.enabled),user.id,name);syncEnabled(name); return send(200, collectorStatus(user)); }
        if (req.method === 'POST' && path === '/api/meta/poll') { const name=accountName((await body(req)).username);if(!subscribed(user,name))throw new AppError('구독을 찾을 수 없습니다.',404);await collector.poll(name);return send(200,collectorStatus(user)); }
        const publish = /^\/api\/analyses\/([0-9a-f-]+)\/google$/.exec(path);
        if (req.method === 'POST' && publish) {
          const row = visible(publish[1]);
          if ((await body(req)).confirmed !== true) throw new AppError('Google 등록 확인이 필요합니다.');
          return send(200, await google.publish({...row,id:user.admin?row.id:`${user.id}:${row.id}`}));
        }
      }
      if (req.method === 'GET' && path === '/api/status') return send(200, { configured: !!apiKey, model, count: store.count(), limit, busy });
      if (req.method === 'GET' && path === '/api/analyses') return send(200, accounts.listIds(user).map(r=>accounts.decorate(store.get(r.id),user)));
      const match = /^\/api\/analyses\/([0-9a-f-]+)(\/review|\/calendar.ics)?$/.exec(path);
      if (match) {
        const row = visible(match[1]);
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
          accounts.review(row.id, user, validateReview(input.events));
          return send(200, visible(row.id));
        }
      }
      if (req.method === 'POST' && path === '/api/analyze') {
        return send(200, accounts.decorate(await analyzeInput(await body(req),user),user));
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
  server.on('listening', () => {collector?.start();monitor?.start();});
  server.on('close', () => {collector?.stop();monitor?.stop();});
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(join(root, 'data'), { recursive: true });
  const store = createStore(join(root, 'data', 'events.sqlite'));
  const port = Number(process.env.PORT ?? 3080), limit = Number(process.env.DAILY_ANALYSIS_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 또는 DAILY_ANALYSIS_LIMIT 설정을 확인하세요.');
  const vault = createVault(join(root, 'data'));
  const server = makeServer({ monitoring:true,store, vault, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.4-mini', limit });
  server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('서버 실행 실패: 포트가 사용 중인지 확인하세요.'); process.exitCode = 1; });
}
