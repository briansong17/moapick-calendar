let reconciliationBusy=false,reconciliationLast=0,reconciliationTimer,reconciliationRequested=false;
async function refreshReconciliationStatus(){
 if(!signedIn||document.hidden||!navigator.onLine)return;
 const status=document.getElementById('sync-status');
 try{const result=await api('/api/sync/status');
  status.hidden=false;status.textContent=result.pending?'서버에서 Google 반영을 처리하고 있습니다.':'Google 캘린더 반영을 확인했습니다.';
  if(result.pending){status.textContent='Google 캘린더에 반영 중입니다. 화면을 닫아도 자동으로 다시 시도합니다.';reconciliationTimer=setTimeout(refreshReconciliationStatus,60000);}
  else await Promise.all([loadManagedEvents(),history(),connections()]);
 }catch{status.textContent='진행 상태를 조회하지 못했습니다. 서버의 대기 작업은 유지됩니다.';reconciliationTimer=setTimeout(refreshReconciliationStatus,60000);}
}
async function reconcileCalendar(begin=true){
 if(!signedIn||document.hidden||!navigator.onLine)return;if(reconciliationBusy){reconciliationRequested=true;return;}
 if(begin&&Date.now()-reconciliationLast<20000)return;
 reconciliationBusy=true;reconciliationLast=Date.now();clearTimeout(reconciliationTimer);
 const status=document.getElementById('sync-status');status.hidden=false;status.textContent='Google 캘린더와 동기화 중…';
 let again=false;
 try{
  const r=await api('/api/sync/reconcile',{begin});
  status.textContent=r.reason??(r.more?'Google 일정 추가·삭제를 계속 확인하고 있습니다…':r.pending?'일부 일정이 Google 반영 대기 중입니다. 자동으로 다시 확인합니다.':'Google 캘린더 반영을 확인했습니다.');
  again=r.more||(r.pending&&r.retryable!==false);
  if(!r.more)await Promise.all([loadManagedEvents(),history(),connections()]);
  if(r.background){status.textContent='서버가 Google 반영을 이어서 처리합니다. 화면을 닫아도 괜찮아요.';reconciliationTimer=setTimeout(refreshReconciliationStatus,5000);}
  else if(again)reconciliationTimer=setTimeout(()=>reconcileCalendar(!r.more),r.more?1000:60000);
 }catch(e){status.textContent='연결 상태를 다시 확인하고 있습니다. 설정의 연결 확인에서 상태를 볼 수 있어요.';diagnosticLog('reconcile.client_failed',{code:diagnosticCategory(e.message)});reconciliationTimer=setTimeout(()=>reconcileCalendar(true),60000);}
 finally{reconciliationBusy=false;if(reconciliationRequested){reconciliationRequested=false;clearTimeout(reconciliationTimer);reconciliationTimer=setTimeout(()=>reconcileCalendar(true),30000);}}
}
function requestReconciliation(){reconciliationLast=0;void reconcileCalendar(true);}
function setupReconciliation(){
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void reconcileCalendar(true);});
 addEventListener('pageshow',()=>void reconcileCalendar(true));addEventListener('online',()=>requestReconciliation());
}
