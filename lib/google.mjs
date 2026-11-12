import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash } from 'node:crypto';
import { AppError, validateReview } from './extraction.mjs';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const GOOGLE_REDIRECT = 'http://127.0.0.1:3080/oauth/google/callback';
const digest = value => createHash('sha256').update(value).digest('hex');
const nextDay = value => { const d = new Date(value); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export function googleEvent(event, id, source) {
  validateReview([event]);
  if (event.start_time && !event.end_time) throw new AppError('Google 등록에는 종료 시간이 필요합니다. 원문 확인 후 종료 시간을 입력해 주세요.');
  const stamp = (day, time) => ({ dateTime: `${day}T${time}:00${event.timezone === 'Asia/Seoul' ? '+09:00' : 'Z'}`, timeZone: event.timezone });
  return {
    id, summary: event.title, location: event.location || '',
    description: [event.description, event.booking_url, source].filter(Boolean).join('\n'),
    start: event.start_time ? stamp(event.start_date, event.start_time) : { date: event.start_date },
    end: event.start_time ? stamp(event.end_date || event.start_date, event.end_time) : { date: nextDay(event.end_date || event.start_date) },
    extendedProperties: { private: { moa: id } },
  };
}
export function createGoogle({ vault, db, clientFactory = options => new OAuth2Client(options) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS google_exports(analysis_id TEXT NOT NULL, fingerprint TEXT NOT NULL, calendar_id TEXT NOT NULL, status TEXT NOT NULL, links TEXT, PRIMARY KEY(analysis_id,calendar_id));`);
  const pending = new Map(); let writing = false;
  const client = () => {
    const config = vault.get('googleClient');
    if (!config) throw new AppError('먼저 Google OAuth 클라이언트 JSON을 등록하세요.');
    const c = clientFactory({ clientId: config.client_id, clientSecret: config.client_secret, redirectUri: GOOGLE_REDIRECT });
    c.setCredentials(vault.get('googleTokens') ?? {});
    c.on('tokens', tokens => vault.set('googleTokens', { ...vault.get('googleTokens'), ...tokens }));
    return c;
  };
  const call = async (path, { method = 'GET', data } = {}) => {
    try { return (await client().request({ url: `https://www.googleapis.com/calendar/v3${path}`, method, data, retry: false, timeout: 30000 })).data; }
    catch (e) {
      const status = e.response?.status;
      if (status === 401 || e.response?.data?.error === 'invalid_grant') throw new AppError('Google 인증이 만료되거나 철회되었습니다. 다시 연결하세요.', 401);
      if (status === 403) throw new AppError('Calendar API 활성화 및 승인한 권한을 확인하세요.', 403);
      if (status === 409) throw new AppError('이미 존재하는 Google 일정입니다.', 409);
      if (status === 404) throw new AppError('전용 캘린더 또는 일정을 찾을 수 없습니다.', 404);
      throw new AppError('Google 연결에 실패했습니다. 기록을 보존했으며 다시 등록해도 동일 ID를 사용합니다.', 502);
    }
  };
  return {
    status: () => ({ configured: !!vault.get('googleClient'), connected: !!vault.get('googleTokens')?.refresh_token, calendar: vault.get('googleCalendar')?.summary ?? null, calendarPending: !!vault.get('googleCalendarPending') }),
    configure(input) {
      if (vault.get('googleTokens')?.refresh_token) throw new AppError('연결된 상태에서는 OAuth 클라이언트를 교체할 수 없습니다.');
      const web = input?.web;
      if (!web || typeof web.client_id !== 'string' || !web.client_id.endsWith('.apps.googleusercontent.com') || typeof web.client_secret !== 'string' || !web.client_secret || !web.redirect_uris?.includes(GOOGLE_REDIRECT)) throw new AppError(`웹 애플리케이션 JSON과 리디렉션 URI ${GOOGLE_REDIRECT}를 확인하세요.`);
      vault.set('googleClient', { client_id: web.client_id, client_secret: web.client_secret });
    },
    async begin() {
      for (const [state, entry] of pending) if (entry.expires < Date.now()) pending.delete(state);
      const c = client(), state = randomBytes(32).toString('hex'), binding = randomBytes(32).toString('hex');
      const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync();
      pending.set(state, { binding, codeVerifier, expires: Date.now() + 600000 });
      return { binding, url: c.generateAuthUrl({ scope: [GOOGLE_SCOPE], access_type: 'offline', prompt: 'consent', state, code_challenge: codeChallenge, code_challenge_method: 'S256' }) };
    },
    async callback(params, binding) {
      const state = params.get('state'), entry = pending.get(state);
      if (!entry || entry.expires < Date.now() || entry.binding !== binding) throw new AppError('Google 로그인 요청이 만료되었거나 일치하지 않습니다. 다시 연결하세요.');
      pending.delete(state);
      if (params.has('error')) throw new AppError('Google 권한 승인이 취소되었습니다.');
      try {
        const { tokens } = await client().getToken({ code: params.get('code'), codeVerifier: entry.codeVerifier, redirect_uri: GOOGLE_REDIRECT });
        if (!tokens.refresh_token || !tokens.scope?.split(' ').includes(GOOGLE_SCOPE)) throw new Error('missing consent');
        // Retain a calendar on reauthorization only if this grant can access it.
        const previousCalendar = vault.get('googleCalendar');
        vault.set('googleTokens', tokens);
        if (previousCalendar) {
          try { await call(`/calendars/${encodeURIComponent(previousCalendar.id)}`); }
          catch (error) {
            if ([403, 404].includes(error.status)) { vault.set('googleCalendar', null); vault.set('googleCalendarPending', null); }
            else throw error;
          }
        }
      } catch { throw new AppError('Google 인증을 완료하지 못했습니다. 필요한 권한을 승인하고 다시 연결하세요.', 502); }
    },
    async createCalendar() {
      if (writing) throw new AppError('Google 작업이 진행 중입니다.', 409);
      if (vault.get('googleCalendar')) return { created: false };
      if (vault.get('googleCalendarPending')) throw new AppError('이전 캘린더 생성 결과가 불확실합니다. 중복 방지를 위해 Google 캘린더에서 생성 여부를 먼저 확인해야 합니다.', 409);
      if (!vault.get('googleTokens')?.refresh_token) throw new AppError('먼저 Google 계정을 연결하세요.');
      writing = true;
      try {
        vault.set('googleCalendarPending', { at: new Date().toISOString() });
        const created = await call('/calendars', { method: 'POST', data: { summary: '모아 · Instagram 일정', timeZone: 'Asia/Seoul' } });
        vault.set('googleCalendar', { id: created.id, summary: created.summary }); vault.set('googleCalendarPending', null);
        return { created: true };
      } catch (error) {
        if ([401, 403].includes(error.status)) vault.set('googleCalendarPending', null);
        throw error;
      } finally { writing = false; }
    },
    async publish(record) {
      if (writing) throw new AppError('Google 작업이 진행 중입니다.', 409);
      if (!record.reviewed) throw new AppError('먼저 원문을 검토하고 일정을 저장하세요.');
      const calendar = vault.get('googleCalendar');
      if (!calendar) throw new AppError('먼저 전용 캘린더를 만들어 주세요.');
      const fingerprint = digest(JSON.stringify(record.reviewed));
      const existing = db.prepare('SELECT * FROM google_exports WHERE analysis_id=? AND calendar_id=?').get(record.id, calendar.id);
      if (existing && existing.fingerprint !== fingerprint) throw new AppError('이미 등록을 시작한 일정이 수정되었습니다. 사용자 변경 보호를 위해 자동 덮어쓰기를 중단했습니다. Google 캘린더에서 직접 수정하세요.', 409);
      if (existing?.status === 'complete') return { reused: true, links: JSON.parse(existing.links) };
      const payloads = record.reviewed.map((e, index) => googleEvent(e, digest(`moa:${record.id}:${index}`), record.metadata.source_url));
      writing = true;
      try {
        db.prepare("INSERT OR IGNORE INTO google_exports VALUES(?,?,?,'pending',NULL)").run(record.id, fingerprint, calendar.id);
        const links = [];
        for (const payload of payloads) {
          const base = `/calendars/${encodeURIComponent(calendar.id)}/events`;
          let event;
          try { event = await call(base, { method: 'POST', data: payload }); }
          catch (error) {
            if (error.status !== 409) throw error;
            event = await call(`${base}/${payload.id}`);
            if (event.status === 'cancelled') throw new AppError('Google에서 삭제된 일정이 있습니다. 자동 복원하지 않았습니다.', 409);
          }
          links.push(event.htmlLink ?? '');
        }
        db.prepare("UPDATE google_exports SET status='complete',links=? WHERE analysis_id=? AND calendar_id=?").run(JSON.stringify(links), record.id, calendar.id);
        return { reused: false, links };
      } finally { writing = false; }
    },
  };
}
