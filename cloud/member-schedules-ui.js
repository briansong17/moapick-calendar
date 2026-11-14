let scheduleMembers=[],scheduleMembersNext=0,scheduleMembersLoading=false,scheduleMemberId='',scheduleEvents=[],scheduleNext=null,scheduleLoading=false,scheduleGeneration=0,scheduleGoogleBusy=false;
const scheduleReasons={eligible:'Google 등록 대상',missing_date:'시작 날짜 확인 필요',ended:'이미 종료된 일정',deleted:'웹에서 삭제됨',review_excluded:'검토에서 제외됨',invalid_event:'날짜·시간 확인 필요'};
function bindMemberSchedules(user){
 const allowed=!!user?.memberSchedules;document.getElementById('member-schedules-nav').hidden=!allowed;
 scheduleGeneration++;scheduleMembers=[];scheduleMembersNext=0;scheduleMemberId='';scheduleEvents=[];scheduleNext=null;scheduleLoading=false;scheduleGoogleBusy=false;
 document.getElementById('schedule-member').replaceChildren(new Option('회원을 선택하세요',''));
 document.getElementById('member-schedules').replaceChildren();document.querySelector('.member-schedule-tools').hidden=true;
 for(const id of ['schedule-admin-summary','schedule-admin-status','schedule-member-connection','schedule-google-progress'])document.getElementById(id).textContent='';
 document.getElementById('schedule-events-more').hidden=true;document.getElementById('schedule-members-more').hidden=true;document.getElementById('schedule-member-refresh').disabled=true;
 if(location.hash==='#members')openView(allowed?'members':'events');
}
async function loadScheduleMembers(){
 if(!signedIn?.memberSchedules||scheduleMembersLoading||scheduleMembersNext===null)return;
 scheduleMembersLoading=true;const generation=scheduleGeneration,status=document.getElementById('schedule-admin-status');status.textContent='회원 목록을 불러오고 있습니다…';
 try{const r=await api('/api/admin/members?page='+scheduleMembersNext);if(generation!==scheduleGeneration)return;
  const select=document.getElementById('schedule-member');for(const member of r.members){if(scheduleMembers.some(m=>m.id===member.id))continue;scheduleMembers.push(member);select.add(new Option(member.login,member.id));}
  scheduleMembersNext=r.next;document.getElementById('schedule-members-more').hidden=r.next===null;status.textContent='회원을 선택하면 해당 회원의 일정을 조회합니다.';
 }catch(error){if(generation===scheduleGeneration)status.textContent=error.message;}finally{scheduleMembersLoading=false;}
}
async function loadMemberSchedule(more=false){
 const uid=document.getElementById('schedule-member').value;if(!signedIn?.memberSchedules||!uid)return;
 if(more&&scheduleLoading)return;const generation=more?scheduleGeneration:++scheduleGeneration,offset=more?scheduleNext:0;
 if(!more){scheduleMemberId=uid;scheduleEvents=[];scheduleNext=null;scheduleGoogleBusy=false;document.getElementById('member-schedules').replaceChildren();document.querySelector('.member-schedule-tools').hidden=true;document.getElementById('schedule-events-more').hidden=true;document.getElementById('schedule-google-progress').textContent='';document.getElementById('schedule-admin-summary').textContent='';document.getElementById('schedule-member-connection').textContent='';}
 scheduleLoading=true;document.getElementById('schedule-admin-status').textContent='선택한 회원의 일정을 조회하고 있습니다…';document.getElementById('schedule-member-refresh').disabled=true;
 try{const r=await api('/api/admin/member-events?member='+encodeURIComponent(uid)+'&offset='+offset);if(generation!==scheduleGeneration)return;
  scheduleEvents.push(...r.events);scheduleNext=r.next;document.querySelector('.member-schedule-tools').hidden=false;
  document.getElementById('schedule-events-more').hidden=r.next===null;
  document.getElementById('schedule-member-connection').textContent=(r.google.reconnectRequired?'Google 재연결 필요':!r.google.connected?'Google 연결 없음':!r.google.calendar?'전용 캘린더 없음':'연결 캘린더: '+r.google.calendar)+' · 구독 '+r.subscriptions.length+'개 · '+new Date(r.at).toLocaleString()+' 조회';
  document.getElementById('schedule-admin-status').textContent=r.member.login+' · 분석 '+r.analysisCount+'건 중 현재 '+Math.min(offset+r.pageAnalyses,r.analysisCount)+'건 조회';renderMemberSchedules();
 }catch(error){if(generation===scheduleGeneration)document.getElementById('schedule-admin-status').textContent='조회 실패 · '+error.message;}
 finally{if(generation===scheduleGeneration){scheduleLoading=false;document.getElementById('schedule-member-refresh').disabled=false;}}
}
function visibleMemberSchedules(){
 const text=document.getElementById('schedule-admin-search').value.trim().toLowerCase(),filter=document.getElementById('schedule-admin-filter').value;
 return scheduleEvents.filter(e=>(!text||[e.title,e.account].filter(Boolean).join(' ').toLowerCase().includes(text))&&(filter==='all'||filter==='eligible'&&e.reason==='eligible'||filter==='excluded'&&['missing_date','ended','invalid_event'].includes(e.reason)||filter==='removed'&&['deleted','review_excluded'].includes(e.reason)));
}
function memberGoogleText(v){
 if(!v.connected)return 'Google 연결 없음';if(!v.results.length)return '조회할 캘린더 없음';
 return v.results.map(r=>{
  const prefix=r.calendar==='previous'?'이전 캘린더: ':'';
  if(r.status==='failed')return prefix+'조회 실패'+(r.httpStatus?' ('+r.httpStatus+')':'');
  if(r.status==='present')return prefix+(v.expected==='absent'?'삭제 반영 필요 · Google에 남아 있음':r.matchesExpected===false?'Google에 존재 · 웹 내용과 다름':'Google에 존재');
  return prefix+(v.expected==='present'?'등록 대상이지만 Google에 없음':v.expected==='absent'?'Google 삭제 확인':'Google에 없음');
 }).join(' / ')+(v.limited?' · 일부 캘린더만 확인':'');
}
function renderMemberSchedules(){
 const list=document.getElementById('member-schedules');list.replaceChildren();const events=visibleMemberSchedules();
 document.getElementById('schedule-admin-summary').textContent='불러온 일정 '+scheduleEvents.length+'건 · 웹 표시 '+scheduleEvents.filter(e=>e.webVisible).length+'건 · 등록 대상 '+scheduleEvents.filter(e=>e.reason==='eligible').length+'건 · 현재 표시 '+events.length+'건'+(scheduleNext!==null?' · 다음 페이지 있음':'');
 const node=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
 for(const event of events){
  const card=node('article','','member-schedule'),header=node('div','','member-schedule-heading');header.append(node('h2',event.title||'제목 없음'),node('span',event.reviewed?'검토 완료':'검토 필요','tag'));card.append(header);
  const dates=(event.startDate??'시작 날짜 없음')+(event.startTime?' '+event.startTime:'')+(event.endDate||event.endTime?' → '+(event.endDate??event.startDate??'')+(event.endTime?' '+event.endTime:''):'')+(event.timezone?' · '+event.timezone:'');
  card.append(node('p',dates,'member-schedule-date'));if(event.account)card.append(node('p','@'+event.account,'small'));
  const details=node('dl','','member-schedule-details');
  const field=(label,text)=>details.append(node('dt',label),node('dd',text));
  field('웹 상태',event.webVisible?'일정 목록에 표시':'목록에서 제외');field('자동 등록',scheduleReasons[event.reason]??event.reason);if(event.validation)field('확인 필요',event.validation);
  field('저장 기록',event.stored==='recorded'?'등록 ID 기록 있음':event.stored==='pending'?'Google 처리 기록 대기 중':'등록 ID 기록 없음');
  field('서버 작업',event.job?(event.job.failed?'재시도 대기':'처리 대기')+(event.job.nextDue?' · '+new Date(event.job.nextDue).toLocaleString():''):'대기 작업 없음');
  field('Google 조회',event.verification?memberGoogleText(event.verification)+' · '+new Date(event.verification.at).toLocaleTimeString():'아직 확인하지 않음');card.append(details);
  const button=node('button','Google 확인','secondary');button.type='button';button.disabled=scheduleGoogleBusy;button.onclick=()=>verifyMemberSchedule(event);card.append(button);list.append(card);
 }
 if(!events.length)list.append(node('p',scheduleEvents.length?'현재 조건에 맞는 일정이 없습니다.':'이 페이지에 일정 후보가 없습니다.','small'));
 document.getElementById('schedule-google-page').disabled=scheduleGoogleBusy||!events.length;
}
async function verifyMemberSchedule(event){
 if(!signedIn?.memberSchedules||scheduleGoogleBusy)return;scheduleGoogleBusy=true;const generation=scheduleGeneration,uid=scheduleMemberId;renderMemberSchedules();
 try{const result=await api('/api/admin/member-event-google?'+new URLSearchParams({member:uid,analysis:event.analysisId,index:String(event.index)}));if(generation!==scheduleGeneration)return;event.verification=result;document.getElementById('schedule-google-progress').textContent='Google 조회 완료 · '+memberGoogleText(result);}
 catch(error){if(generation===scheduleGeneration)document.getElementById('schedule-google-progress').textContent='Google 조회 실패 · '+error.message;}
 finally{if(generation===scheduleGeneration){scheduleGoogleBusy=false;renderMemberSchedules();}}
}
async function verifyMemberSchedulePage(){
 if(!signedIn?.memberSchedules||scheduleGoogleBusy)return;const targets=visibleMemberSchedules().slice(0,20),generation=scheduleGeneration,uid=scheduleMemberId;
 scheduleGoogleBusy=true;renderMemberSchedules();let checked=0;
 try{for(const event of targets){if(generation!==scheduleGeneration)return;document.getElementById('schedule-google-progress').textContent='Google 조회 중 · '+checked+'/'+targets.length+'건';
   const result=await api('/api/admin/member-event-google?'+new URLSearchParams({member:uid,analysis:event.analysisId,index:String(event.index)}));if(generation!==scheduleGeneration)return;event.verification=result;checked++;renderMemberSchedules();}
  document.getElementById('schedule-google-progress').textContent='Google 조회 완료 · '+checked+'건'+(visibleMemberSchedules().length>20?' · 나머지는 개별 Google 확인을 이용하세요.':'');
 }catch(error){if(generation===scheduleGeneration)document.getElementById('schedule-google-progress').textContent='Google 조회 '+checked+'건 완료 후 중단 · '+error.message;}
 finally{if(generation===scheduleGeneration){scheduleGoogleBusy=false;renderMemberSchedules();}}
}
function setupMemberSchedules(){
 document.getElementById('schedule-member').onchange=()=>{if(document.getElementById('schedule-member').value)void loadMemberSchedule();else bindMemberSchedules(signedIn);};
 document.getElementById('schedule-members-more').onclick=loadScheduleMembers;document.getElementById('schedule-member-refresh').onclick=()=>loadMemberSchedule();document.getElementById('schedule-events-more').onclick=()=>loadMemberSchedule(true);
 document.getElementById('schedule-admin-search').oninput=renderMemberSchedules;document.getElementById('schedule-admin-filter').onchange=renderMemberSchedules;document.getElementById('schedule-google-page').onclick=verifyMemberSchedulePage;
}
