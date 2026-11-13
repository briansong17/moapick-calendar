let reconciliationBusy=false,reconciliationLast=0,reconciliationTimer,reconciliationRequested=false;
async function reconcileCalendar(begin=true){
 if(!signedIn||document.hidden||!navigator.onLine)return;if(reconciliationBusy){reconciliationRequested=true;return;}
 if(begin&&Date.now()-reconciliationLast<20000)return;
 reconciliationBusy=true;reconciliationLast=Date.now();clearTimeout(reconciliationTimer);
 const status=document.getElementById('sync-status');status.hidden=false;status.textContent='미래 일정의 Google 반영 상태를 확인하고 있습니다…';
 let again=false;
 try{
  const r=await api('/api/sync/reconcile',{begin});
  status.textContent=r.reason??(r.more?'미래 일정을 계속 동기화하고 있습니다…':r.pending?'일부 일정이 반영 대기 중입니다. 자동으로 다시 확인합니다.':'미래 일정 동기화 확인을 마쳤습니다. 아이폰 캘린더 표시는 기기 동기화 후 갱신됩니다.');
  again=r.more||(r.pending&&r.retryable!==false);
  if(!r.more)await Promise.all([loadManagedEvents(),history(),connections()]);
  if(again)reconciliationTimer=setTimeout(()=>reconcileCalendar(!r.more),r.more?1000:60000);
 }catch(e){status.textContent='동기화 확인을 완료하지 못했습니다. 화면 복귀 시 다시 확인합니다. 진행상황에서 로그를 확인하세요.';diagnosticLog('reconcile.client_failed',{code:diagnosticCategory(e.message)});reconciliationTimer=setTimeout(()=>reconcileCalendar(true),60000);}
 finally{reconciliationBusy=false;if(reconciliationRequested){reconciliationRequested=false;clearTimeout(reconciliationTimer);reconciliationTimer=setTimeout(()=>reconcileCalendar(true),30000);}}
}
function requestReconciliation(){reconciliationLast=0;void reconcileCalendar(true);}
function setupReconciliation(){
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void reconcileCalendar(true);});
 addEventListener('pageshow',()=>void reconcileCalendar(true));addEventListener('online',()=>requestReconciliation());
}
