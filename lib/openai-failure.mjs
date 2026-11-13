// Provider messages may contain organization IDs or submitted text. Extract numbers only.
export function openaiFailure(response,error={}){
 const message=String(error.message??''),header=name=>response.headers?.get?.(name);
 const num=value=>{const n=Number(String(value??'').replaceAll(',',''));return value!=null&&value!==''&&Number.isFinite(n)&&n>=0?n:undefined;};
 const limit=num(/\bLimit[: ]+([\d,]+(?:\.\d+)?)/i.exec(message)?.[1]);
 const requested=num(/\bRequested[: ]+([\d,]+(?:\.\d+)?)/i.exec(message)?.[1]);
 const limitType=/tokens per min|\bTPM\b/i.test(message)?'tokens':/requests per min|\bRPM\b/i.test(message)?'requests':'unknown';
 const retry=header('retry-after'),seconds=num(retry),date=Date.parse(retry??'');
 const retryAfterSeconds=Math.min(86400,Math.max(30,Math.ceil(seconds??(Number.isFinite(date)?(date-Date.now())/1000:60))));
 const code=error.code==='insufficient_quota'?'billing':/spend|billing|credit|quota_exceeded/.test(String(error.code??''))?'billing':limitType==='tokens'&&requested>limit?'request_too_large':limitType==='tokens'?'tokens_per_minute':limitType==='requests'?'requests_per_minute':'rate_limit';
 return {code,limitType,retryAfterSeconds,...(limit!==undefined?{limit}:{}),...(requested!==undefined?{requested}:{}),...(num(header('x-ratelimit-limit-tokens'))!==undefined?{tokenLimit:num(header('x-ratelimit-limit-tokens'))}:{}),...(num(header('x-ratelimit-limit-requests'))!==undefined?{requestLimit:num(header('x-ratelimit-limit-requests'))}:{})};
}
