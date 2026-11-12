import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {cipher,validateOrigin,secureCookie} from '../cloud/security.mjs';
test('클라우드 토큰 암호화: 다른 회원 문맥·키·변조값 거절',()=>{
  const c=cipher(randomBytes(32).toString('base64'));const secret={refresh_token:'sentinel'};
  const sealed=c.seal(secret,'google:alice');assert.ok(!sealed.includes('sentinel'));
  assert.deepEqual(c.open(sealed,'google:alice'),secret);
  assert.throws(()=>c.open(sealed,'google:bob'));
  assert.throws(()=>c.open('tampered','google:alice'));
  assert.throws(()=>cipher(randomBytes(32).toString('base64')).open(sealed,'google:alice'));
  assert.throws(()=>cipher('short'));
});
test('클라우드 CSRF·Host 검사와 HTTPS 쿠키',()=>{
  const origin='https://moa.example',req={method:'POST',headers:{host:'moa.example',origin,'content-type':'application/json'}};
  assert.doesNotThrow(()=>validateOrigin(req,origin));
  for(const headers of [{...req.headers,origin:'https://evil.example'},{...req.headers,origin:undefined},{...req.headers,host:'evil.example'},{...req.headers,'content-type':'text/plain'}])assert.throws(()=>validateOrigin({...req,headers},origin));
  assert.doesNotThrow(()=>validateOrigin({method:'GET',headers:{host:'moa.example','sec-fetch-site':'cross-site'}},origin,{callback:true}));
  assert.throws(()=>validateOrigin({method:'GET',headers:{host:'moa.example','sec-fetch-site':'cross-site'}},origin));
  assert.match(secureCookie('__Host-moa','opaque'),/HttpOnly; Secure; SameSite=Lax/);
  assert.match(secureCookie('__Host-moa',''),/Max-Age=0/);
});
