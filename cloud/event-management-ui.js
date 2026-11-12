async function confirmEventDeletion(count){
 const dialog=document.createElement('dialog'),title=el('h2','일정 삭제 확인'),text=el('p',count+'개 일정을 삭제할까요? 모아픽에서 숨기고 이 앱이 등록한 Google 일정도 삭제합니다. 되돌리기 기능은 없습니다.'),cancel=el('button','취소','secondary'),remove=el('button','삭제 확인','primary');
 dialog.append(title,text,cancel,remove);document.body.append(dialog);dialog.showModal();
 return new Promise(resolve=>{const done=value=>{dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>done(false);remove.onclick=()=>done(true);dialog.oncancel=e=>{e.preventDefault();done(false);};cancel.focus();});
}
const managedEvents=new Map();let eventBusy=false;
function eventKey(item){return item.analysis_id+':'+item.index;}
async function loadManagedEvents(){
 const items=[];let offset=0;
 do{const page=await api('/api/events?offset='+offset);items.push(...page.events);offset=page.next;}while(offset!==null);
 managedEvents.clear();for(const item of items)managedEvents.set(eventKey(item),item);renderManagedEvents();renderMiniCalendar();
}
let eventFilter='all',eventSearch='',eventDate='';
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
function renderManagedEvents(){
 $('managed-events').replaceChildren();const all=[...managedEvents.values()];
 const items=all.filter(i=>(eventFilter==='all'||(eventFilter==='reviewed')===i.reviewed)&&i.event.title.toLowerCase().includes(eventSearch)&&(!eventDate||i.event.start_date===eventDate)).sort((a,b)=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const rank=i=>!i.event.start_date?2:(i.event.end_date??i.event.start_date)<today?1:0;return rank(a)-rank(b)||(a.event.start_date??'9999').localeCompare(b.event.start_date??'9999');});
 for(const item of items){const key=eventKey(item),card=el('div',undefined,'managed-row');
 const check=el('input');check.type='checkbox';check.dataset.eventKey=key;check.setAttribute('aria-label',item.event.title+' 선택');
 const date=el('div',item.event.start_date?.slice(8)??'—','date-tile');date.append(el('small',item.event.start_date?Number(item.event.start_date.slice(5,7))+'월':'날짜 미정'));
 const info=el('div'),title=el('button',item.event.title,'managed-title');title.onclick=async()=>{try{render(await api('/api/analyses/'+item.analysis_id));}catch(e){$('event-status').textContent=e.message;}};
 info.append(title,el('small',[item.event.start_time??'종일',item.event.location].filter(Boolean).join(' · '),'event-meta'));
 const state=el('span',item.reviewed?'검토 완료':'검토 필요','event-state'+(item.reviewed?'':' pending'));
 const remove=el('button','×','row-delete');remove.type='button';remove.setAttribute('aria-label',item.event.title+' 삭제');remove.onclick=()=>deleteManaged([key]);const selection=el('label',undefined,'event-select');selection.append(check);card.append(selection,date,info,state,remove);$('managed-events').append(card);
 }
 $('event-count').textContent=String(all.length);$('nav-count').textContent=String(all.length);$('events-select-all').checked=false;
 if(!items.length){const empty=el('div',undefined,'list-empty');empty.append(el('strong',all.length?'일정이 없습니다.':'아직 모인 일정이 없어요.'),el('p',all.length?'검색어나 필터를 바꿔 보세요.':'계정을 구독하거나 행사 이미지를 추가해 보세요.'));$('managed-events').append(empty);}
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===eventFilter)));
}
function renderMiniCalendar(){
 const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();$('month-title').textContent=year+'년 '+(month+1)+'월';$('mini-calendar').replaceChildren();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(let i=0;i<new Date(year,month,1).getDay();i++)$('mini-calendar').append(el('span'));
 for(let day=1;day<=new Date(year,month+1,0).getDate();day++){const key=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'),b=el('button',String(day));b.setAttribute('aria-label',key+' 일정 보기');if(key===today)b.classList.add('today');if(key===eventDate)b.classList.add('selected');if([...managedEvents.values()].some(i=>i.event.start_date===key))b.classList.add('has-events');b.onclick=()=>{eventDate=key;$('clear-date').hidden=false;renderManagedEvents();renderMiniCalendar();};$('mini-calendar').append(b);}
}

async function deleteManaged(keys){
 if(eventBusy)return;if(!keys.length){$('event-status').textContent='삭제할 일정을 선택해 주세요.';return;}
 if(!await confirmEventDeletion(keys.length))return;
 eventBusy=true;document.querySelectorAll('#event-management button,#event-management input').forEach(e=>e.disabled=true);
 const groups=new Map();for(const key of keys){const item=managedEvents.get(key);if(!item)continue;if(!groups.has(item.analysis_id))groups.set(item.analysis_id,[]);groups.get(item.analysis_id).push(item.index);}
 let deleted=0,pending=0,failed=0;
 for(const [id,indices] of groups){try{const r=await api('/api/analyses/'+id+'/delete-events',{indices,confirmed:true});deleted+=r.deleted;if(r.sync?.pending)pending+=r.deleted;}catch{failed+=indices.length;}
  $('event-status').textContent='삭제 처리 중: '+deleted+'개 완료';
 }
 try{await loadManagedEvents();await history();if(current&&document.querySelector('[data-page=review]')?.hidden===false)render(await api('/api/analyses/'+current.id));}catch{failed++;}
 $('event-status').textContent=deleted+'개 삭제'+(pending?' · '+pending+'개는 Google 반영 대기(자동 재시도)':'')+(failed?' · 일부 처리가 실패했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.':'');
 eventBusy=false;document.querySelectorAll('#event-management button,#event-management input').forEach(e=>e.disabled=false);
}
$('events-select-all').onchange=()=>document.querySelectorAll('[data-event-key]').forEach(e=>e.checked=$('events-select-all').checked);
$('events-delete-selected').onclick=()=>deleteManaged([...document.querySelectorAll('[data-event-key]:checked')].map(e=>e.dataset.eventKey));
$('events-delete-all').onclick=()=>deleteManaged([...managedEvents.keys()]);
$('events-reload').onclick=()=>loadManagedEvents().catch(e=>$('event-status').textContent=e.message);

$('event-search').oninput=e=>{eventSearch=e.target.value.trim().toLowerCase();renderManagedEvents();};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{eventFilter=b.dataset.filter;renderManagedEvents();});
$('month-prev').onclick=()=>{calendarMonth.setMonth(calendarMonth.getMonth()-1);renderMiniCalendar();};
$('month-next').onclick=()=>{calendarMonth.setMonth(calendarMonth.getMonth()+1);renderMiniCalendar();};
$('clear-date').onclick=()=>{eventDate='';$('clear-date').hidden=true;renderManagedEvents();renderMiniCalendar();};
