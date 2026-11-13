let reconciliationBusy=false,reconciliationLast=0,reconciliationTimer,reconciliationRequested=false;
async function reconcileCalendar(begin=true){
 if(!signedIn||document.hidden||!navigator.onLine)return;if(reconciliationBusy){reconciliationRequested=true;return;}
 if(begin&&Date.now()-reconciliationLast<20000)return;
 reconciliationBusy=true;reconciliationLast=Date.now();clearTimeout(reconciliationTimer);
 const status=document.getElementById('sync-status');status.hidden=false;status.textContent='미래 일정 추가와 웹에서 삭제한 일정의 Google 반영 상태를 확인하고 있습니다…';
 let again=false;
 try{
  const r=await api('/api/sync/reconcile',{begin});
  status.textContent=r.reason??(r.more?'Google 일정 추가·삭제를 계속 확인하고 있습니다…':r.pending?'일부 일정이 Google 반영 대기 중입니다. 자동으로 다시 확인합니다.':'Google 서버의 일정 추가·삭제 반영을 확인했습니다. 휴대폰 앱의 수신 완료 여부는 별도입니다.');
  again=r.more||(r.pending&&r.retryable!==false);
  if(!r.more)await Promise.all([loadManagedEvents(),history(),connections()]);
  if(again)reconciliationTimer=setTimeout(()=>reconcileCalendar(!r.more),r.more?1000:60000);
 }catch(e){status.textContent='Google 반영 상태를 확인하지 못했습니다. 온라인으로 이 화면을 열어두면 약 1분 뒤 재시도하며, 다시 접속할 때도 확인합니다. 진행상황에서 로그를 확인하세요.';diagnosticLog('reconcile.client_failed',{code:diagnosticCategory(e.message)});reconciliationTimer=setTimeout(()=>reconcileCalendar(true),60000);}
 finally{reconciliationBusy=false;if(reconciliationRequested){reconciliationRequested=false;clearTimeout(reconciliationTimer);reconciliationTimer=setTimeout(()=>reconcileCalendar(true),30000);}}
}
function requestReconciliation(){reconciliationLast=0;void reconcileCalendar(true);}
function setupReconciliation(){
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void reconcileCalendar(true);});
 addEventListener('pageshow',()=>void reconcileCalendar(true));addEventListener('online',()=>requestReconciliation());
}
