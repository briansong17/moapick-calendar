import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {AppError} from '../lib/extraction.mjs';
import {digest,cookiePolicy} from './security.mjs';
const cookie=(req,name)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
export function createAuth({db,crypto,origin,supabaseUrl,localDevelopment=false}) {
  const policy=cookiePolicy(origin,{allowLocal:localDevelopment}),SESSION=policy.name('__Host-moa'),FLOW=policy.name('__Host-moa-login'),secureCookie=policy.serialize;
  async function session(req) {
    const id=cookie(req,SESSION);if(!/^[a-f0-9]{64}$/.test(id??''))return null;
    const hash=digest(id),[row]=await db.admin('moa_sessions',{id:`eq.${hash}`,expires_at:`gt.${new Date().toISOString()}`});
    if(!row)return null;
    let tokens=crypto.open(row.encrypted,`session:${hash}`);
    if(tokens.expires_at*1000<Date.now()+30000) {
      const owner=randomUUID();
      if(!await db.rpc('moa_claim_lock',{p_name:'session:'+hash,p_owner:owner,p_seconds:30}))throw new AppError('로그인을 갱신 중입니다. 잠시 후 새로고침하세요.',409);
      try{
        const [fresh]=await db.admin('moa_sessions',{id:`eq.${hash}`});if(!fresh)throw new AppError('로그인해 주세요.',401);
        tokens=crypto.open(fresh.encrypted,`session:${hash}`);
        if(tokens.expires_at*1000<Date.now()+30000){tokens=await db.auth('token?grant_type=refresh_token',{method:'POST',body:{refresh_token:tokens.refresh_token}});
          await db.admin('moa_sessions',{id:`eq.${hash}`},{method:'PATCH',body:{encrypted:crypto.seal(tokens,`session:${hash}`)}});}
      }finally{await db.admin('moa_locks',{name:`eq.session:${hash}`,owner:`eq.${owner}`},{method:'DELETE'});}
    }
    const user=await db.auth('user',{token:tokens.access_token});
    if(user.id!==row.user_id || !user.email_confirmed_at)throw new AppError('인증된 Google 계정으로 로그인해 주세요.',401);
    return {user:{id:user.id,login:user.email,admin:false},token:tokens.access_token,hash,created_at:row.created_at};
  }
  return {
    session,
    async begin(res) {
      const verifier=randomBytes(48).toString('base64url');
      const challenge=createHash('sha256').update(verifier).digest('base64url');
      res.setHeader('Set-Cookie',secureCookie(FLOW,crypto.seal({verifier,expires:Date.now()+600000},'login'),600));
      const url=new URL('/auth/v1/authorize',supabaseUrl);
      for(const [k,v] of Object.entries({provider:'google',redirect_to:origin+'/auth/callback',code_challenge:challenge,code_challenge_method:'s256'}))url.searchParams.set(k,v);
      return {url:url.href};
    },
    async callback(req,res,params) {
      const value=cookie(req,FLOW);if(!value||!params.get('code'))throw new AppError('로그인 요청을 다시 시작해 주세요.',400);
      const flow=crypto.open(value,'login');if(flow.expires<Date.now())throw new AppError('로그인 요청이 만료되었습니다.',400);
      const tokens=await db.auth('token?grant_type=pkce',{method:'POST',body:{auth_code:params.get('code'),code_verifier:flow.verifier}});
      const user=await db.auth('user',{token:tokens.access_token});if(!user.email_confirmed_at)throw new AppError('이메일 인증이 필요합니다.',401);
      const id=randomBytes(32).toString('hex'),hash=digest(id);
      await db.admin('moa_sessions',{}, {method:'POST',body:{id:hash,user_id:user.id,encrypted:crypto.seal(tokens,`session:${hash}`),expires_at:new Date(Date.now()+7*86400000).toISOString()}});
      res.setHeader('Set-Cookie',[secureCookie(SESSION,id),secureCookie(FLOW,'')]);
      return user;
    },
    async logout(req,res) {
      const id=cookie(req,SESSION);if(/^[a-f0-9]{64}$/.test(id??''))await db.admin('moa_sessions',{id:`eq.${digest(id)}`},{method:'DELETE'});
      res.setHeader('Set-Cookie',secureCookie(SESSION,''));
    },
    async remove(s,input,res) {
      if(input.confirmation!=='계정 삭제')throw new AppError('계정 삭제 문구를 입력해 주세요.');
      if(Date.now()-Date.parse(s.created_at)>10*60000)throw new AppError('탈퇴 전 Google 계정으로 다시 로그인해 주세요.',401);
      await db.auth(`admin/users/${s.user.id}`,{method:'DELETE',admin:true});
      res.setHeader('Set-Cookie',secureCookie(SESSION,''));
    }
  };
}
