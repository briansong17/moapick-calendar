const viewNames={diagnostics:'진행상황',events:'내 일정',subscriptions:'구독',upload:'이미지 추가',history:'분석 기록',settings:'설정',review:'일정 검토'};
function openView(view,writeHash=true){
 if(!viewNames[view])view='events';document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.dataset.page!==view);
 document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if(view==='diagnostics')queueMicrotask(autoRefreshDiagnostics);
 $('page-label').textContent=viewNames[view];if(writeHash&&location.hash!=='#'+view)window.history.replaceState(null,'','#'+view);window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view));
window.addEventListener('hashchange',()=>openView(location.hash.slice(1),false));
$('today-label').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
openView(location.hash.slice(1)||'events',false);renderMiniCalendar();
