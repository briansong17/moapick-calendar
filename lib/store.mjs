import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AppError } from './extraction.mjs';

export const seoulDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function createStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL, status TEXT NOT NULL,
      day TEXT NOT NULL, created_at TEXT NOT NULL, metadata TEXT NOT NULL,
      result TEXT, reviewed TEXT, usage TEXT, error TEXT
    );
    CREATE INDEX IF NOT EXISTS analysis_hash ON analyses(hash);
    CREATE INDEX IF NOT EXISTS analysis_day ON analyses(day);
    UPDATE analyses SET status='interrupted', error='서버가 재시작되어 분석이 중단됐습니다.' WHERE status='running';`);
  const decode = row => row && { ...row, metadata: JSON.parse(row.metadata), result: row.result && JSON.parse(row.result), reviewed: row.reviewed && JSON.parse(row.reviewed), usage: row.usage && JSON.parse(row.usage) };
  return {
    db,
    count: () => db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE day=?').get(seoulDay()).n,
    cached: hash => decode(db.prepare("SELECT * FROM analyses WHERE hash=? AND status='complete' ORDER BY created_at DESC LIMIT 1").get(hash)),
    get: id => decode(db.prepare('SELECT * FROM analyses WHERE id=?').get(id)),
    list: () => db.prepare('SELECT * FROM analyses ORDER BY created_at DESC LIMIT 50').all().map(decode),
    start(hash, metadata, limit) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE day=?').get(seoulDay()).n >= limit) throw new AppError('오늘의 분석 요청 한도에 도달했습니다.', 429);
        const id = randomUUID();
        db.prepare('INSERT INTO analyses(id, hash, status, day, created_at, metadata) VALUES(?,?,?,?,?,?)').run(id, hash, 'running', seoulDay(), new Date().toISOString(), JSON.stringify(metadata));
        db.exec('COMMIT'); return id;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    complete(id, result, usage) { db.prepare("UPDATE analyses SET status='complete',result=?,usage=? WHERE id=?").run(JSON.stringify(result), JSON.stringify(usage), id); },
    fail(id, message) { db.prepare("UPDATE analyses SET status='failed',error=? WHERE id=?").run(message, id); },
    review(id, events) { db.prepare('UPDATE analyses SET reviewed=? WHERE id=?').run(JSON.stringify(events), id); },
  };
}
