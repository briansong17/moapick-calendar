import { createHash } from 'node:crypto';
import { AppError } from './extraction.mjs';

export const accountName = value => {
  if (typeof value !== 'string') throw new AppError('계정 아이디가 필요합니다.');
  const name = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(name)) throw new AppError('Instagram 계정 아이디를 확인하세요.');
  return name;
};
export const contentHash = post => createHash('sha256').update(JSON.stringify({ id: post.id, caption: post.caption ?? '', type: post.media_type, children: post.children?.data?.map(c => [c.id, c.media_type]) ?? [] })).digest('hex');

export function safeMediaURL(value) {
  let u; try { u = new URL(value); } catch { throw new AppError('이미지 주소가 유효하지 않습니다.'); }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !['cdninstagram.com', 'fbcdn.net'].some(domain => u.hostname === domain || u.hostname.endsWith(`.${domain}`))) throw new AppError('Meta 이미지 CDN 주소만 허용합니다.');
  return u;
}
export async function downloadImage(url, fetchImpl = fetch) {
  let u = safeMediaURL(url);
  for (let redirect = 0; redirect < 4; redirect++) {
    let response;
    try { response = await fetchImpl(u, { redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
    catch { throw new AppError('게시물 이미지를 가져오지 못했습니다.', 502); }
    if ([301, 302, 303, 307, 308].includes(response.status)) { u = safeMediaURL(new URL(response.headers.get('location'), u).href); continue; }
    if (!response.ok) throw new AppError('이미지 링크가 만료되었거나 접근할 수 없습니다.', 502);
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new AppError('지원하지 않는 게시물 이미지 형식입니다.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new AppError('게시물 이미지가 3MB를 초과합니다. 수동 업로드가 필요합니다.'); }
      chunks.push(Buffer.from(value));
    }
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
  }
  throw new AppError('이미지 주소 이동 횟수가 너무 많습니다.');
}
export function createInstagram({ vault, fetchImpl = fetch }) {
  async function graph(fields, override) {
    const config = override ?? vault.get('meta');
    if (!config) throw new AppError('새 Meta 앱의 토큰과 Instagram ID를 먼저 설정하세요.');
    const url = new URL(`https://graph.facebook.com/${config.version}/${config.ig_id}`);
    url.searchParams.set('fields', fields);
    let response;
    try { response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30000) }); }
    catch { throw new AppError('Meta API 연결에 실패했습니다.', 502); }
    let data; try { data = await response.json(); } catch { throw new AppError('Meta 응답을 읽지 못했습니다.', 502); }
    if (!response.ok || data.error) {
      const code = data.error?.code;
      if (code === 190) throw new AppError('Meta 토큰 만료 또는 권한 철회: 새 토큰으로 다시 연결하세요.', 401);
      if ([4, 17, 32, 613, 80002].includes(code)) throw new AppError('Meta 호출 한도에 도달했습니다. 다음 주기에 재시도합니다.', 429);
      throw new AppError(`Meta 조회 실패${Number.isInteger(code) ? ` (코드 ${code})` : ''}. 앱 권한·페이지 연결·대상 계정을 확인하세요. 개인 계정 여부는 이 오류만으로 판단할 수 없습니다.`, 502);
    }
    return data;
  }
  return {
    status: () => ({ configured: !!vault.get('meta'), account: vault.get('meta')?.username ?? null, version: vault.get('meta')?.version ?? null }),
    async configure(input) {
      if (!/^\d{5,30}$/.test(input?.ig_id ?? '') || !/^v\d{2}\.\d$/.test(input?.version ?? '') || typeof input?.token !== 'string' || input.token.length < 20 || input.token.length > 4096) throw new AppError('Instagram ID, API 버전(v숫자.0), 새 액세스 토큰을 확인하세요.');
      const config = { ig_id: input.ig_id, version: input.version, token: input.token };
      const self = await graph('id,username', config);
      vault.set('meta', { ...config, username: self.username });
    },
    async page(username, after = '') {
      const name = accountName(username);
      if (after && !/^[A-Za-z0-9_+/=-]{1,4096}$/.test(after)) throw new AppError('Meta 페이지 커서를 확인할 수 없습니다.', 502);
      const fields = `business_discovery.username(${name}){id,username,media.limit(10)${after ? `.after(${after})` : ''}{id,caption,permalink,timestamp,media_type,media_url,children{id,media_type,media_url}}}`;
      const data = (await graph(fields)).business_discovery;
      if (!data?.id || !Array.isArray(data.media?.data)) throw new AppError('이 계정의 게시물 조회 권한 또는 API 지원 여부를 확인할 수 없습니다.', 422);
      return { username: data.username, posts: data.media.data, after: data.media.paging?.next ? data.media.paging?.cursors?.after ?? null : null };
    },
    download: url => downloadImage(url, fetchImpl),
  };
}

export function createCollector({ db, instagram, analyze, interval = 60 * 60 * 1000 }) {
  db.exec(`CREATE TABLE IF NOT EXISTS watched_accounts(username TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_checked TEXT, next_due INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS instagram_posts(id TEXT PRIMARY KEY, username TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, analysis_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL);
    UPDATE instagram_posts SET status='pending' WHERE status='running';`);
  let busy = false, timer;
  const list = () => db.prepare('SELECT * FROM watched_accounts ORDER BY username').all();
  async function poll(username) {
    if (busy) throw new AppError('수집 작업이 진행 중입니다.', 409);
    const account = db.prepare('SELECT * FROM watched_accounts WHERE username=?').get(username);
    if (!account) throw new AppError('관찰 계정을 먼저 등록하세요.');
    busy = true;
    try {
      let after = '', page = 0, truncated = false;
      do {
        const result = await instagram.page(username, after);
        for (const post of result.posts) {
          if (!/^\d+$/.test(post.id ?? '')) continue;
          const old = db.prepare('SELECT * FROM instagram_posts WHERE id=?').get(post.id), hash = contentHash(post);
          if (!old || old.hash !== hash) {
            db.prepare(`INSERT INTO instagram_posts(id,username,hash,payload,status,updated_at) VALUES(?,?,?,?,'pending',?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,payload=excluded.payload,status='pending',attempts=0,error=NULL,updated_at=excluded.updated_at`).run(post.id, username, hash, JSON.stringify(post), new Date().toISOString());
          } else {
            // Refresh signed image links without causing another AI call.
            db.prepare('UPDATE instagram_posts SET payload=? WHERE id=?').run(JSON.stringify(post), post.id);
          }
        }
        after = result.after; page++;
        if (page >= (account.last_checked ? 3 : 1)) { truncated = !!after; break; }
      } while (after);
      const queue = db.prepare("SELECT * FROM instagram_posts WHERE username=? AND status IN ('pending','failed') AND attempts<3 ORDER BY updated_at LIMIT 5").all(username);
      for (const row of queue) {
        const post = JSON.parse(row.payload);
        const media = post.media_type === 'CAROUSEL_ALBUM' ? post.children?.data ?? [] : [post];
        const photos = media.filter(m => m.media_type === 'IMAGE' && m.media_url);
        if (!photos.length) { db.prepare("UPDATE instagram_posts SET status='skipped',error='지원하는 사진이 없습니다. 영상 분석은 미지원입니다.' WHERE id=?").run(row.id); continue; }
        if (photos.length > 3) { db.prepare("UPDATE instagram_posts SET status='skipped',error='이미지가 3장을 초과합니다. 누락 방지를 위해 수동 분석이 필요합니다.' WHERE id=?").run(row.id); continue; }
        db.prepare("UPDATE instagram_posts SET status='running',attempts=attempts+1 WHERE id=?").run(row.id);
        try {
          const images = []; for (const photo of photos) images.push(await instagram.download(photo.media_url));
          const result = await analyze({ images, caption: post.caption ?? '', account: username, source_url: post.permalink ?? '', posted_at: post.timestamp?.slice(0, 10) ?? '' });
          db.prepare("UPDATE instagram_posts SET status='complete',analysis_id=?,error=NULL WHERE id=?").run(result.id, row.id);
        } catch (e) {
          if ([409, 429].includes(e.status)) { db.prepare("UPDATE instagram_posts SET status='pending',attempts=attempts-1,error=? WHERE id=?").run(e.message, row.id); break; }
          db.prepare("UPDATE instagram_posts SET status='failed',error=? WHERE id=?").run(e instanceof AppError ? e.message : '게시물 분석 실패', row.id);
        }
      }
      db.prepare('UPDATE watched_accounts SET last_checked=?,next_due=?,error=? WHERE username=?').run(new Date().toISOString(), Date.now() + interval, truncated ? `이번 조회는 최근 ${page * 10}개까지 확인했습니다. 더 이전 게시물은 수집 범위 밖입니다.` : null, username);
    } catch (e) {
      db.prepare('UPDATE watched_accounts SET next_due=?,error=? WHERE username=?').run(Date.now() + interval, e instanceof AppError ? e.message : '수집 실패', username);
      throw e;
    } finally { busy = false; }
  }
  return {
    status: () => ({ busy, interval_minutes: interval / 60000, accounts: list(), posts: db.prepare('SELECT id,username,status,analysis_id,attempts,error,updated_at FROM instagram_posts ORDER BY updated_at DESC LIMIT 50').all() }),
    async add(value) {
      const name = accountName(value);
      if (list().length >= 3 && !list().some(a => a.username === name)) throw new AppError('시험 운영은 최대 3개 계정까지 지원합니다.');
      await instagram.page(name);
      db.prepare('INSERT OR IGNORE INTO watched_accounts(username) VALUES(?)').run(name);
    },
    enable(value, enabled) {
      const name = accountName(value);
      if (typeof enabled !== 'boolean') throw new AppError('활성화 여부를 확인하세요.');
      db.prepare('UPDATE watched_accounts SET enabled=? WHERE username=?').run(Number(enabled), name);
    },
    poll,
    start() {
      if (timer) return;
      timer = setInterval(async () => {
        if (busy) return;
        const due = list().find(a => a.enabled && a.next_due <= Date.now());
        if (due) { try { await poll(due.username); } catch {} }
      }, 30000);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = undefined; },
  };
}
