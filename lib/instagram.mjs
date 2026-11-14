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
export function createInstagram({ vault, fetchImpl = fetch, onDiagnostic = () => {} }) {
  async function graph(fields, override) {
    const config = override ?? vault.get('meta');
    if (!config) throw new AppError('새 Meta 앱의 토큰과 Instagram ID를 먼저 설정하세요.');
    const url = new URL(`https://graph.facebook.com/${config.version}/${config.ig_id}`);
    url.searchParams.set('fields', fields);
    const started = Date.now();
    onDiagnostic('meta.http.start', { operation: fields.startsWith('business_discovery.') ? 'business_discovery' : 'self' });
    let response;
    try { response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(30000) }); }
    catch { onDiagnostic('meta.http.failed', { category: 'meta_network', durationMs: Date.now() - started }); throw new AppError('Meta API 연결에 실패했습니다.', 502); }
    let data; try { data = await response.json(); } catch { onDiagnostic('meta.http.failed', { status: response.status, category: 'meta_response', durationMs: Date.now() - started }); throw new AppError('Meta 응답을 읽지 못했습니다.', 502); }
    if (!response.ok || data.error) {
      const code = data.error?.code, subcode = data.error?.error_subcode;
      const category = code === 200 && subcode === 5258005 ? 'meta_access_blocked' : code === 190 ? 'meta_auth_required' : [4, 17, 32, 613, 80002].includes(code) ? 'meta_rate_limit' : [10, 200].includes(code) ? 'meta_permission' : 'meta_request';
      // Only structured codes are logged. Provider text can contain credentials or personal data.
      onDiagnostic('meta.http.failed', { status: response.status, ...(Number.isInteger(code) ? { code } : {}), ...(Number.isInteger(subcode) ? { subcode } : {}), category, durationMs: Date.now() - started });
      if (category === 'meta_access_blocked') throw new AppError('Meta API 접근이 차단됐습니다 (코드 200/5258005). 운영자가 Meta 개발자 계정의 보안 확인·제한 알림을 확인해야 합니다.', 502);
      if (code === 190) { vault.set('metaReconnectRequired',true); throw new AppError('Meta 토큰 만료 또는 권한 철회: 관리자가 새 토큰으로 다시 연결해야 합니다.', 401); }
      if ([4, 17, 32, 613, 80002].includes(code)) throw new AppError('Meta 호출 한도에 도달했습니다. 다음 주기에 재시도합니다.', 429);
      throw new AppError(`Meta 조회 실패${Number.isInteger(code) ? ` (코드 ${code})` : ''}. 앱 권한·페이지 연결·대상 계정을 확인하세요. 개인 계정 여부는 이 오류만으로 판단할 수 없습니다.`, 502);
    }
    onDiagnostic('meta.http.complete', { status: response.status, durationMs: Date.now() - started });
    return data;
  }
  return {
    status: () => ({ configured: !!vault.get('meta'), reconnectRequired:!!vault.get('metaReconnectRequired'), account: vault.get('meta')?.username ?? null, version: vault.get('meta')?.version ?? null }),
    async configure(input) {
      if (!/^\d{5,30}$/.test(input?.ig_id ?? '') || !/^v\d{2}\.\d$/.test(input?.version ?? '') || typeof input?.token !== 'string' || input.token.length < 20 || input.token.length > 4096) throw new AppError('Instagram ID, API 버전(v숫자.0), 새 액세스 토큰을 확인하세요.');
      const config = { ig_id: input.ig_id, version: input.version, token: input.token };
      const self = await graph('id,username', config);
      vault.set('meta', { ...config, username: self.username });
      vault.set('metaReconnectRequired',false);
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

export { createCollector } from './collector.mjs';
