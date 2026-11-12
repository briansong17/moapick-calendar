import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './extraction.mjs';
const derive = promisify(scrypt), hash = s => createHash('sha256').update(s).digest('hex');
export function createAccounts(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT NOT NULL,username TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,username));
    CREATE TABLE IF NOT EXISTS analysis_owners(analysis_id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_reviews(user_id TEXT NOT NULL,analysis_id TEXT NOT NULL,events TEXT NOT NULL,PRIMARY KEY(user_id,analysis_id));`);
  const attempts = new Map();
  const publicUser = u => u && ({ id: u.id, login: u.login, admin: !!u.admin });
  const session = u => { const token = randomBytes(32).toString('hex'); db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), u.id, Date.now()+7*86400000); return { user: publicUser(u), token }; };
  return {
    empty: () => !db.prepare('SELECT 1 FROM users LIMIT 1').get(),
    async authenticate(input, signup, ip) {
      const now=Date.now(); for(const [k,v] of attempts) if(v.until<now) attempts.delete(k);
      const rate=attempts.get(ip) ?? { count:0,until:now+15*60000 }; rate.count++; attempts.set(ip,rate);
      if(rate.count>20) throw new AppError('로그인 시도가 많습니다. 15분 후 다시 시도하세요.',429);
      const login=typeof input.login==='string'?input.login.trim().toLowerCase():'';
      if(!/^[a-z0-9_.@+-]{3,100}$/.test(login) || typeof input.password!=='string' || input.password.length<10 || input.password.length>128) throw new AppError('아이디는 영문·숫자 3~100자, 비밀번호는 10~128자로 입력하세요.');
      let u=db.prepare('SELECT * FROM users WHERE login=?').get(login);
      if(signup) {
        if(u) throw new AppError('사용할 수 없는 아이디입니다.',409);
        const salt=randomBytes(16).toString('hex'), password=(await derive(input.password,salt,64)).toString('hex');
        // Recheck bootstrap inside a synchronous transaction after asynchronous hashing.
        db.exec('BEGIN IMMEDIATE');
        try {
          const admin=!db.prepare('SELECT 1 FROM users LIMIT 1').get();
          u={id:randomUUID(),login,salt,password,admin:Number(admin)};
          db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(u.id,login,salt,password,u.admin,new Date().toISOString());
          if(admin) {
            db.prepare('INSERT OR IGNORE INTO analysis_owners SELECT id,? FROM analyses').run(u.id);
            db.prepare('INSERT OR IGNORE INTO user_reviews SELECT ?,id,reviewed FROM analyses WHERE reviewed IS NOT NULL').run(u.id);
            if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='watched_accounts'").get()) db.prepare('INSERT OR IGNORE INTO subscriptions SELECT ?,username,enabled FROM watched_accounts').run(u.id);
          }
          db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); if(e.code?.includes('CONSTRAINT')) throw new AppError('사용할 수 없는 아이디입니다.',409); throw e; }
      } else {
        const candidate=await derive(input.password,u?.salt ?? '00000000000000000000000000000000',64);
        if(!u || !timingSafeEqual(candidate,Buffer.from(u.password,'hex'))) throw new AppError('아이디 또는 비밀번호를 확인하세요.',401);
      }
      return session(u);
    },
    user(cookie='') { const token=/(?:^|;\s*)moa_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1]; if(!token)return null; return publicUser(db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(hash(token),Date.now())); },
    logout(cookie='') { const token=/(?:^|;\s*)moa_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1]; if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); },
    own(id,user) { db.prepare('INSERT OR IGNORE INTO analysis_owners VALUES(?,?)').run(id,user.id); },
    listIds(user) {
      const hasPosts=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='instagram_posts'").get();
      return db.prepare(`SELECT a.id FROM analyses a WHERE EXISTS(SELECT 1 FROM analysis_owners o WHERE o.analysis_id=a.id AND o.user_id=?) ${hasPosts?'OR EXISTS(SELECT 1 FROM instagram_posts p JOIN subscriptions s ON p.username=s.username WHERE p.analysis_id=a.id AND s.user_id=?)':''} ORDER BY a.created_at DESC LIMIT 50`).all(...(hasPosts?[user.id,user.id]:[user.id]));
    },
    accessible(row,user) { return !!row && (!!db.prepare('SELECT 1 FROM analysis_owners WHERE analysis_id=? AND user_id=?').get(row.id,user.id) || (!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='instagram_posts'").get() && !!db.prepare('SELECT 1 FROM subscriptions s JOIN instagram_posts p ON p.username=s.username WHERE s.user_id=? AND p.analysis_id=?').get(user.id,row.id))); },
    decorate(row,user) { return {...row,reviewed:JSON.parse(db.prepare('SELECT events FROM user_reviews WHERE user_id=? AND analysis_id=?').get(user.id,row.id)?.events ?? 'null')}; },
    review(id,user,events) { db.prepare('INSERT INTO user_reviews VALUES(?,?,?) ON CONFLICT(user_id,analysis_id) DO UPDATE SET events=excluded.events').run(user.id,id,JSON.stringify(events)); },
  };
}
export const sessionCookie = token => `moa_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token?604800:0}`;
