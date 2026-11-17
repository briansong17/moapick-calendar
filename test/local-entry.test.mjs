import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOrigin,cookiePolicy} from '../cloud/security.mjs';

test('local HTTP is limited to explicit development mode, loopback address and matching origin',()=>{
 const origin='http://127.0.0.1:3080';
 const req={method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3080',origin,'content-type':'application/json'}};
 assert.throws(()=>validateOrigin(req,origin));
 assert.doesNotThrow(()=>validateOrigin(req,origin,{allowLocal:true}));
 assert.throws(()=>validateOrigin({...req,socket:{remoteAddress:'192.168.0.2'}},origin,{allowLocal:true}));
 assert.throws(()=>validateOrigin({...req,headers:{...req.headers,origin:'https://other.example'}},origin,{allowLocal:true}));
 assert.throws(()=>validateOrigin({...req,headers:{...req.headers,host:'other.example'}},origin,{allowLocal:true}));
 assert.throws(()=>validateOrigin(req,'http://other.example',{allowLocal:true}));
});

test('development cookies are separate, and production retains Secure and __Host cookies',()=>{
 const prod=cookiePolicy('https://moa-calendar-eta.vercel.app',{allowLocal:true});
 assert.equal(prod.name('__Host-moa'),'__Host-moa');assert.match(prod.serialize('__Host-moa','test'),/; Secure;/);
 const local=cookiePolicy('http://127.0.0.1:3080',{allowLocal:true});
 assert.equal(local.name('__Host-moa'),'local-moa');assert.equal(local.name('__Host-moa-google'),'local-moa-google');
 assert.doesNotMatch(local.serialize('local-moa','test'),/; Secure;/);assert.match(local.serialize('local-moa','test'),/; HttpOnly;/);
 const strict=cookiePolicy('http://127.0.0.1:3080');assert.equal(strict.name('__Host-moa'),'__Host-moa');
});
