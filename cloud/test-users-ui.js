let testMode=false,testVisitBusy=false;
function collectionResultMessage(result){
 if(result.processed)return '게시물 1개를 확인했습니다.';
 if(result.reason==='no_enabled_subscription')return '활성 구독이 없어 수집하지 않았습니다.';
 const deferred=result.deferred??[],next=deferred.map(a=>Date.parse(a.nextDue)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
 return (deferred.some(a=>a.failed)?'이전 수집 오류로 대기 중입니다. 진행상황에서 원인을 확인하세요.':'수집 예정 시각 전이라 이번 요청에서는 수집하지 않았습니다.')+(next?' 다음 확인: '+new Date(next).toLocaleString('ko-KR'): '');
}
async function loadTestUser(){if(!signedIn)return;const pref=await api('/api/test/settings');testMode=pref.test_user;document.getElementById('test-user-toggle').checked=testMode;document.getElementById('test-reset').disabled=!testMode;document.getElementById('test-status').textContent=testMode?'테스트 사용자 · 실행당 게시물 최대 1개':'일반 사용자';}
async function testVisit(){if(!signedIn||testVisitBusy||!navigator.onLine)return;testVisitBusy=true;
 try{await loadTestUser();if(!testMode)return;const r=await api('/api/test/collect',{});document.getElementById('test-status').textContent=collectionResultMessage(r);if(r.processed)await Promise.all([history(),connections(),loadManagedEvents()]);}
 catch(e){document.getElementById('test-status').textContent=e.message;diagnosticLog('test.collect.failed',{code:diagnosticCategory(e.message)});}finally{testVisitBusy=false;}}
function setupTestUsers(){
 document.getElementById('test-user-toggle').onchange=async e=>{e.target.disabled=true;try{await api('/api/test/settings',{test_user:e.target.checked});await loadTestUser();}catch(err){e.target.checked=testMode;document.getElementById('test-status').textContent=err.message;}finally{e.target.disabled=false;}};
 document.getElementById('test-reset').onclick=async e=>{const confirmation=document.getElementById('test-reset-confirmation').value;if(confirmation!=='분석 기록 초기화'){document.getElementById('test-status').textContent='확인 문구를 입력하세요.';return;}e.target.disabled=true;try{await api('/api/test/reset',{confirmation});document.getElementById('test-reset-confirmation').value='';await history();document.getElementById('test-status').textContent='분석 기록을 초기화했습니다. 웹을 새로고침하면 최신 게시물부터 최대 1개를 수집합니다.';}catch(err){document.getElementById('test-status').textContent=err.message;}finally{e.target.disabled=!testMode;}};
}
