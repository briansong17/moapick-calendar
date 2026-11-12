import {AppError} from '../lib/extraction.mjs';
export function createSupabase(env,fetchImpl=fetch) {
  const url=new URL(env.SUPABASE_URL);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))throw new Error('Invalid Supabase URL');
  const request=async(path,{method='GET',body,token,admin=false,prefer}={})=>{
    let r;
    try{r=await fetchImpl(new URL(path,url),{method,headers:{apikey:admin?env.SUPABASE_SECRET_KEY:env.SUPABASE_PUBLISHABLE_KEY,
      ...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
    catch{throw new AppError('회원 저장소에 연결하지 못했습니다.',503);}
    if(!r.ok)throw new AppError(r.status===401?'로그인이 만료되었습니다. 다시 로그인하세요.':'회원 저장소 요청에 실패했습니다.',r.status===401?401:503);
    if(r.status===204)return null;
    const text=await r.text();return text?JSON.parse(text):null;
  };
  const table=(name,query={})=>{
    if(!/^moa_[a-z_]+$/.test(name))throw new Error('Invalid table');
    return `/rest/v1/${name}?${new URLSearchParams(query)}`;
  };
  return {
    auth:(path,options={})=>request(`/auth/v1/${path}`,options),
    read:(name,query,token)=>request(table(name,query),{token}),
    admin:(name,query={},options={})=>request(table(name,query),{...options,admin:true}),
    rpc:(name,body)=>{if(!/^moa_[a-z_]+$/.test(name))throw new Error('Invalid RPC');return request(`/rest/v1/rpc/${name}`,{method:'POST',body,admin:true});}
  };
}
