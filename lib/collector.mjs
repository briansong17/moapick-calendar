import { AppError, validDate } from './extraction.mjs';
import { accountName, contentHash } from './instagram.mjs';
import { seoulDay } from './store.mjs';

// A post containing future/unknown dates is not a reliable historical boundary.
export function pastBoundary(result, today=seoulDay()) {
  const events=result?.events;
  return !!events?.length && !result.warnings?.length && events.some(e=>e.kind==='event' && !/(구성\s*공고|당선인\s*공고|명단\s*발표)/.test(e.title)) && events.every(e =>
    validDate(e.start_date) && validDate(e.end_date ?? e.start_date) &&
    (e.end_date ?? e.start_date)>=e.start_date && (e.end_date ?? e.start_date)<today &&
    !(e.needs_review ?? []).some(n=>!n.includes('시간대')));
}
export function createCollector({db,instagram,analyze,interval=60*60*1000,today=seoulDay}) {
  db.exec(`CREATE TABLE IF NOT EXISTS watched_accounts(username TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,last_checked TEXT,next_due INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS instagram_posts(id TEXT PRIMARY KEY,username TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,analysis_id TEXT,attempts INTEGER NOT NULL DEFAULT 0,error TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection_scans(username TEXT PRIMARY KEY,phase TEXT NOT NULL DEFAULT 'initial',cursor TEXT NOT NULL DEFAULT '',queue TEXT NOT NULL DEFAULT '[]',next_cursor TEXT,processed INTEGER NOT NULL DEFAULT 0,reason TEXT,seen TEXT NOT NULL DEFAULT '[]');
    UPDATE instagram_posts SET status='pending' WHERE status='running';
    INSERT OR IGNORE INTO collection_scans(username,phase,reason) SELECT username,'ready','기존 계정 수집 이력 유지' FROM watched_accounts;`);
  let busy=false,timer;
  const list=()=>db.prepare('SELECT a.*,s.phase,s.reason,s.processed FROM watched_accounts a JOIN collection_scans s USING(username) ORDER BY username').all();
  const scan=name=>db.prepare('SELECT * FROM collection_scans WHERE username=?').get(name);
  const finish=(name,reason)=>db.prepare("UPDATE collection_scans SET phase='ready',cursor='',queue='[]',next_cursor=NULL,seen='[]',reason=? WHERE username=?").run(reason,name);
  async function processPost(row) {
    const post=JSON.parse(row.payload), media=post.media_type==='CAROUSEL_ALBUM'?post.children?.data ?? []:[post];
    const photos=media.filter(m=>m.media_type==='IMAGE'&&m.media_url);
    const incomplete=media.some(m=>m.media_type!=='IMAGE'||!m.media_url) || !!post.children?.paging?.next;
    if(!photos.length || photos.length>20 || incomplete) { db.prepare("UPDATE instagram_posts SET status='skipped',error=? WHERE id=?").run(photos.length>20?'사진이 20장을 초과하여 수동 확인이 필요합니다.':'영상 또는 누락된 이미지가 있어 전체 내용을 확인할 수 없습니다. 원문을 확인하세요.',row.id); return null; }
    // Previously skipped 4–20 image posts can now be processed when encountered again.
    if(row.status==='complete') {
      // Real app supplies analyses; isolated collector tests may not.
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='analyses'").get()) return JSON.parse(db.prepare('SELECT result FROM analyses WHERE id=?').get(row.analysis_id)?.result ?? 'null');
      return null;
    }
    if(row.attempts>=3)return null;
    db.prepare("UPDATE instagram_posts SET status='running',attempts=attempts+1 WHERE id=?").run(row.id);
    try {
      const images=[]; for(const photo of photos)images.push(await instagram.download(photo.media_url));
      const result=await analyze({images,caption:post.caption??'',account:row.username,source_url:post.permalink??'',posted_at:post.timestamp?.slice(0,10)??''});
      db.prepare("UPDATE instagram_posts SET status='complete',analysis_id=?,error=NULL WHERE id=?").run(result.id,row.id);
      return result.result;
    } catch(e) {
      if([409,429].includes(e.status)) { db.prepare("UPDATE instagram_posts SET status='pending',attempts=attempts-1,error=? WHERE id=?").run(e.message,row.id); throw e; }
      db.prepare("UPDATE instagram_posts SET status='failed',error=? WHERE id=?").run(e instanceof AppError?e.message:'게시물 분석 실패',row.id);
      throw new AppError('이미지 분석에 실패했습니다. 다음 수집에서 재시도합니다.',502);
    }
  }
  async function poll(username) {
    if(busy)throw new AppError('수집 작업이 진행 중입니다.',409);
    if(!scan(username))throw new AppError('구독 계정을 먼저 등록하세요.');
    busy=true; let warning=null;
    try {
      if(scan(username).phase==='paused')throw new AppError('초기 수집 1,000개 상한에 도달했습니다. 관리자 확인이 필요합니다.',409);
      if(scan(username).phase==='ready')db.prepare("UPDATE collection_scans SET phase='refresh',processed=0,reason=NULL WHERE username=?").run(username);
      // Signed CDN URLs may expire while a queue waits for the next daily budget.
      const resumed=scan(username), pendingIds=new Set(JSON.parse(resumed.queue));
      if(pendingIds.size) {
        const fresh=await instagram.page(username,resumed.cursor);
        for(const post of fresh.posts) if(pendingIds.has(post.id)) {
          const previous=db.prepare('SELECT hash FROM instagram_posts WHERE id=?').get(post.id);
          if(previous.hash!==contentHash(post)) db.prepare("UPDATE instagram_posts SET hash=?,payload=?,status='pending',attempts=0,error=NULL WHERE id=?").run(contentHash(post),JSON.stringify(post),post.id);
          else db.prepare('UPDATE instagram_posts SET payload=? WHERE id=?').run(JSON.stringify(post),post.id);
        }
      }
      let handled=0,pages=0;
      while(handled<5 && pages<3) {
        let s=scan(username), queue=JSON.parse(s.queue);
        if(!queue.length) {
          const result=await instagram.page(username,s.cursor); pages++;
          // API chronology is used; timestamps sort each fetched page, avoiding pinned ordering within it.
          const posts=[...result.posts].sort((a,b)=>(b.timestamp??'').localeCompare(a.timestamp??''));
          for(const post of posts) {
            if(!/^\d+$/.test(post.id??''))continue;
            const old=db.prepare('SELECT * FROM instagram_posts WHERE id=?').get(post.id), hash=contentHash(post);
            if(!old || old.hash!==hash) db.prepare(`INSERT INTO instagram_posts(id,username,hash,payload,status,updated_at) VALUES(?,?,?,?,'pending',?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,payload=excluded.payload,status='pending',attempts=0,error=NULL,updated_at=excluded.updated_at`).run(post.id,username,hash,JSON.stringify(post),new Date().toISOString());
            else db.prepare('UPDATE instagram_posts SET payload=? WHERE id=?').run(JSON.stringify(post),post.id);
            queue.push(post.id);
          }
          const seen=JSON.parse(s.seen);
          if(result.after && (result.after===s.cursor || seen.includes(result.after)))throw new AppError('동일한 페이지 커서가 반복되어 수집을 중단했습니다.',502);
          if(result.after)seen.push(result.after);
          db.prepare('UPDATE collection_scans SET queue=?,next_cursor=?,seen=? WHERE username=?').run(JSON.stringify(queue),result.after??null,JSON.stringify(seen),username);
          s=scan(username);
          if(!queue.length) { if(!s.next_cursor){finish(username,'게시물 끝까지 확인');break;} db.prepare("UPDATE collection_scans SET cursor=next_cursor WHERE username=?").run(username); continue; }
        }
        const row=db.prepare('SELECT * FROM instagram_posts WHERE id=?').get(queue[0]);
        const result=await processPost(row); handled++;
        queue.shift();
        db.prepare('UPDATE collection_scans SET queue=?,processed=processed+1 WHERE username=?').run(JSON.stringify(queue),username);
        s=scan(username);
        if(pastBoundary(result,today())) {finish(username,'지난 행사 일정 확인');break;}
        if(s.phase==='initial' && s.processed>=1000) {db.prepare("UPDATE collection_scans SET phase='paused',reason='초기 수집 1,000개 상한: 수동 확인 필요' WHERE username=?").run(username);break;}
        if(!queue.length) {
          if(!s.next_cursor) {finish(username,'게시물 끝까지 확인');break;}
          if(s.phase==='refresh' && s.processed>=30) {finish(username,'최근 30개 확인 (더 이전 변경은 범위 밖)');break;}
          db.prepare('UPDATE collection_scans SET cursor=next_cursor WHERE username=?').run(username);
        }
      }
    } catch(e) { warning=e instanceof AppError?e.message:'수집 실패'; throw e; }
    finally {
      db.prepare('UPDATE watched_accounts SET last_checked=?,next_due=?,error=? WHERE username=?').run(new Date().toISOString(),Date.now()+interval,warning,username);
      busy=false;
    }
  }
  return {
    status:()=>({busy,interval_minutes:interval/60000,accounts:list(),posts:db.prepare('SELECT id,username,status,analysis_id,attempts,error,updated_at FROM instagram_posts ORDER BY updated_at DESC LIMIT 100').all()}),
    async add(value) {
      const name=accountName(value);
      if(scan(name))return name;
      await instagram.page(name);
      db.prepare('INSERT OR IGNORE INTO watched_accounts(username) VALUES(?)').run(name);
      db.prepare('INSERT OR IGNORE INTO collection_scans(username) VALUES(?)').run(name);
      return name;
    },
    enable(value,enabled) {if(typeof enabled!=='boolean')throw new AppError('활성화 여부를 확인하세요.'); db.prepare('UPDATE watched_accounts SET enabled=? WHERE username=?').run(Number(enabled),accountName(value));},
    poll,
    start(){timer=setInterval(async()=>{if(busy)return;const due=list().filter(a=>a.enabled&&a.next_due<=Date.now()&&a.phase!=='paused').sort((a,b)=>a.next_due-b.next_due)[0];if(due)try{await poll(due.username);}catch{}},30000);timer.unref();},
    stop(){clearInterval(timer);},
  };
}
