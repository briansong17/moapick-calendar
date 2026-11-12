import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {AppError} from '../lib/extraction.mjs';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function cipher(encodedKey) {
  const key=Buffer.from(encodedKey??'','base64');
  if(key.length!==32)throw new Error('TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return {
    seal(value,context) {const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));
      const bytes=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
      return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64url');},
    open(value,context) {try{const bytes=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAAD(Buffer.from(context));d.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString());}catch{throw new AppError('저장된 연결 정보를 확인할 수 없습니다. 관리자에게 문의하세요.',503);}}
  };
}
export function validateOrigin(req,origin,{callback=false}={}) {
  const expected=new URL(origin);
  if(expected.protocol!=='https:' || expected.username || expected.password || expected.pathname!=='/')throw new Error('PUBLIC_ORIGIN must be an HTTPS origin');
  if(req.headers.host!==expected.host)throw new AppError('허용되지 않은 주소입니다.',403);
  if(req.headers.origin && req.headers.origin!==expected.origin)throw new AppError('다른 사이트 요청은 허용하지 않습니다.',403);
  if(req.headers['sec-fetch-site']==='cross-site'&&!callback)throw new AppError('다른 사이트 요청은 허용하지 않습니다.',403);
  if(req.method!=='GET' && req.method!=='HEAD') {
    if(req.headers.origin!==expected.origin)throw new AppError('요청 출처를 확인할 수 없습니다.',403);
    if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('JSON 요청이 필요합니다.',415);
  }
}
export const secureCookie=(name,value,maxAge=604800)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?maxAge:0}`;
export const securityHeaders={
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
