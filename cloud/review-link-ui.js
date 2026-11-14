const requestedReviewKey='moapick-requested-review';
function requestedReviewId(){
 const direct=new URLSearchParams(location.search).get('analysis');
 if(/^[a-f0-9-]{36}$/.test(direct??''))return direct;
 try{const saved=sessionStorage.getItem(requestedReviewKey);return /^[a-f0-9-]{36}$/.test(saved??'')?saved:null;}catch{return null;}
}
try{const id=requestedReviewId();if(id)sessionStorage.setItem(requestedReviewKey,id);}catch{}
async function openRequestedAnalysis(){
 if(!signedIn)return;
 const id=requestedReviewId();if(!id)return;
 try{sessionStorage.removeItem(requestedReviewKey);}catch{}
 try{render(await api('/api/analyses/'+id));}catch(error){diagnosticNotice('요청한 일정을 열지 못했습니다. '+error.message);}
}
