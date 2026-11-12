const $ = id => document.getElementById(id);
let current, previewUrls = [];
const kinds = { event: '행사', registration: '신청·모집', reservation: '예약', other: '기타' };
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '요청에 실패했습니다.');
  return value;
}
function message(text) { $('message').textContent = text; }
async function status() {
  const s = await api('/api/status');
  $('usage').textContent = `${s.configured ? 'API 키 설정됨' : 'API 키 미설정'} · 오늘 요청 ${s.count}/${s.limit}회 · ${s.model}`;
}
async function history() {
  const rows = await api('/api/analyses'); $('history').replaceChildren();
  if (!rows.length) $('history').append(el('p', '아직 분석 기록이 없습니다.', 'small'));
  rows.forEach(row => {
    const wrap = el('div', undefined, 'history-row'), info = el('div');
    info.append(el('strong', row.result?.events[0]?.title || row.metadata.account || '이미지 분석'));
    info.append(el('small', new Date(row.created_at).toLocaleString('ko-KR') + ` · 이미지 ${row.metadata.image_count}장 · ${row.reviewed ? '확인 완료' : row.status === 'complete' ? '검토 대기' : row.status === 'running' ? '분석 중' : '분석 실패'}`));
    const b = el('button', row.status === 'complete' ? '열기 →' : '상태 보기'); b.type = 'button';
    b.onclick = () => { if (row.result) render(row); else message(row.error || '분석 중입니다. 잠시 후 기록을 새로고침하세요.'); };
    wrap.append(info, b); $('history').append(wrap);
  });
}
function field(name, label, value, type = 'text') {
  const l = el('label', label), i = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') i.type = type;
  i.dataset.field = name; i.value = value ?? ''; l.append(i); return l;
}
function invalidate() { $('confirmed').checked = false; $('download').hidden = true; $('google-publish').hidden = true; $('result-badge').textContent = '검토 중'; }
function render(row) {
  current = row; $('empty').hidden = true; $('results').hidden = false; $('confirmed').checked = false;
  $('summary').textContent = row.result.summary;
  $('warnings').textContent = row.result.warnings.join('\n');
  $('events').replaceChildren();
  const events = row.reviewed ?? row.result.events;
  events.forEach((e, index) => {
    const card = el('article', undefined, 'event'); card.dataset.index = index;
    const heading = el('div', undefined, 'event-head'); heading.append(el('strong', `${String(index + 1).padStart(2, '0')} · ${kinds[e.kind]}`));
    const remove = el('button', '제외', 'text-button'); remove.type = 'button'; remove.onclick = () => { card.remove(); invalidate(); };
    heading.append(remove); card.append(heading, field('title', '일정 제목', e.title));
    const dates = el('div', undefined, 'fields'); dates.append(field('start_date', '시작 날짜', e.start_date, 'date'), field('end_date', '마지막 날짜 (해당 날짜 포함)', e.end_date, 'date'));
    const times = el('div', undefined, 'fields'); times.append(field('start_time', '시작 시간 (비우면 종일)', e.start_time, 'time'), field('end_time', '종료 시간 (선택)', e.end_time, 'time'));
    const zoneLabel = el('label', '시간대'), zone = el('select'); zone.dataset.field = 'timezone';
    [['', '시간대 확인 필요'], ['Asia/Seoul', '한국 · Asia/Seoul'], ['UTC', 'UTC']].forEach(([v, name]) => { const o = el('option', name); o.value = v; zone.append(o); });
    zone.value = e.timezone ?? ''; zoneLabel.append(zone);
    card.append(dates, times, zoneLabel, field('location', '장소', e.location), field('description', '설명', e.description, 'textarea'), field('booking_url', '신청·예약 링크', e.booking_url));
    card.append(el('p', `추출 근거\n${e.evidence.join('\n') || '명시된 근거 없음'}`, 'evidence'));
    const notes = [...e.needs_review];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if ((e.end_date ?? e.start_date) && (e.end_date ?? e.start_date) < today) notes.push('이미 지난 날짜입니다. 저장 전 확인하세요.');
    if (notes.length) card.append(el('p', notes.join('\n'), 'review-note'));
    card.addEventListener('input', invalidate); $('events').append(card);
  });
  $('save').disabled = !events.length;
  $('confirmed').parentElement.hidden = !events.length;
  $('download').hidden = !row.reviewed;
  $('google-publish').hidden = !row.reviewed;
  $('download').href = `/api/analyses/${row.id}/calendar.ics`;
  $('download').download = 'events.ics';
  $('result-badge').textContent = row.reviewed ? '확인 완료' : `${events.length}개 후보`;
  message(!events.length ? '확실한 일정 정보를 찾지 못했습니다. 날짜가 보이는 다른 이미지를 올려 주세요.' : row.cached ? '기존 분석 결과를 불러왔습니다. API를 추가 호출하지 않았습니다.' : '원문과 비교하고 필요한 정보를 수정해 주세요.');
}
$('images').onchange = () => {
  previewUrls.forEach(URL.revokeObjectURL); previewUrls = []; $('previews').replaceChildren();
  for (const file of [...$('images').files].slice(0, 3)) { const i = el('img'); i.alt = file.name; i.src = URL.createObjectURL(file); previewUrls.push(i.src); $('previews').append(i); }
};
const readImage = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); r.readAsDataURL(file); });
$('upload-form').onsubmit = async event => {
  event.preventDefault(); $('analyze').disabled = true;
  try {
    const files = [...$('images').files];
    if (!files.length || files.length > 3 || files.some(f => f.size > 3 * 1024 * 1024)) throw new Error('3MB 이하 이미지 1~3장을 선택해 주세요.');
    message('이미지를 읽고 일정을 정리하고 있습니다. 최대 2분 정도 걸릴 수 있어요.');
    const data = Object.fromEntries(['caption', 'account', 'source_url', 'posted_at'].map(k => [k, $(k).value]));
    data.images = await Promise.all(files.map(readImage));
    render(await api('/api/analyze', data));
  } catch (e) { message(e.message); }
  finally { $('analyze').disabled = false; await Promise.all([status(), history()]).catch(() => {}); }
};
$('save').onclick = async () => {
  try {
    if (!$('confirmed').checked) throw new Error('원문과 비교했다는 확인란을 선택해 주세요.');
    const original = current.reviewed ?? current.result.events;
    const events = [...$('events').children].map(card => {
      const e = { ...original[Number(card.dataset.index)] };
      card.querySelectorAll('[data-field]').forEach(i => { e[i.dataset.field] = i.value.trim() || (['title', 'description'].includes(i.dataset.field) ? '' : null); });
      return e;
    });
    const row = await api(`/api/analyses/${current.id}/review`, { events, confirmed: true });
    render(row); message('확인한 일정을 저장했습니다. 캘린더 파일로 내려받을 수 있습니다.'); await history();
  } catch (e) { message(e.message); }
};
$('refresh').onclick = () => Promise.all([status(), history()]).catch(e => message(e.message));
Promise.all([status(), history()]).catch(e => message(e.message));

const connectionMessage = text => { $('connection-message').textContent = text; };
async function connections() {
  const s = await api('/api/integrations');
  $('google-status').textContent = s.google.calendar ? `연결 완료 · ${s.google.calendar}` : s.google.connected ? 'Google 승인 완료 · 전용 캘린더 생성 필요' : s.google.configured ? '클라이언트 설정 완료 · 계정 연결 필요' : '새 Google OAuth 클라이언트 설정 필요';
  if (s.google.calendarPending) $('google-status').textContent += ' · 이전 캘린더 생성 결과 확인 필요';
  $('google-connect').disabled = !s.google.configured;
  $('google-calendar').disabled = !s.google.connected || !!s.google.calendar || s.google.calendarPending;
  $('meta-status').textContent = s.meta.configured ? `연결 설정됨 · @${s.meta.account} · ${s.meta.version}` : '새 Meta 앱·토큰 설정 필요';
  $('watch-list').replaceChildren();
  for (const a of s.collector.accounts) {
    const row = el('div', undefined, 'history-row'), info = el('div');
    info.append(el('strong', `@${a.username}`), el('small', `${a.enabled ? '자동 수집 켜짐' : '자동 수집 꺼짐'} · 마지막 확인 ${a.last_checked ? new Date(a.last_checked).toLocaleString('ko-KR') : '없음'}`));
    if (a.error) info.append(el('p', a.error, 'small'));
    const actions = el('div', undefined, 'actions'), toggle = el('button', a.enabled ? '자동 수집 끄기' : '자동 수집 켜기', 'secondary'), poll = el('button', '지금 수집', 'secondary');
    toggle.onclick = () => runConnection(async () => { await api('/api/meta/enable', { username: a.username, enabled: !a.enabled }); return '자동 수집 설정을 저장했습니다.'; });
    poll.onclick = () => runConnection(async () => { poll.disabled = true; connectionMessage('게시물을 조회하고 분석 중입니다. 잠시 기다려 주세요.'); await api('/api/meta/poll', { username: a.username }); await Promise.all([history(), status()]); return '수집이 끝났습니다. 처리 기록과 분석 결과를 확인하세요.'; });
    actions.append(toggle, poll); row.append(info, actions); $('watch-list').append(row);
  }
  $('post-log').replaceChildren();
  const names = { pending: '분석 대기', running: '분석 중', complete: '분석 완료', failed: '분석 실패', skipped: '수동 확인 필요' };
  for (const p of s.collector.posts) $('post-log').append(el('p', `@${p.username} · ${p.id} · ${names[p.status]}${p.error ? ` · ${p.error}` : ''}`, 'small'));
}
async function runConnection(fn) {
  try { connectionMessage(await fn()); } catch (e) { connectionMessage(e.message); }
  finally { await connections().catch(() => {}); }
}
$('connection-refresh').onclick = () => connections().catch(e => connectionMessage(e.message));
$('google-config').onclick = () => runConnection(async () => {
  const file = $('google-json').files[0]; if (!file || file.size > 100000) throw new Error('Google 클라이언트 JSON 파일을 선택하세요.');
  let config; try { config = JSON.parse(await file.text()); } catch { throw new Error('JSON 파일을 읽을 수 없습니다.'); }
  await api('/api/google/config', config); $('google-json').value = ''; return '클라이언트를 암호화 저장했습니다.';
});
$('google-connect').onclick = () => runConnection(async () => { const { url } = await api('/api/google/connect', {}); window.location.assign(url); return 'Google 로그인 화면으로 이동합니다.'; });
$('google-manual-config').onclick = () => runConnection(async () => {
  try {
    await api('/api/google/config', { web: { client_id: $('google-client-id').value.trim(), client_secret: $('google-client-secret').value.trim(), redirect_uris: ['http://127.0.0.1:3080/oauth/google/callback'] } });
    return '클라이언트를 암호화 저장했습니다. Google 계정 연결을 진행하세요.';
  } finally { $('google-client-secret').value = ''; }
});
$('google-calendar').onclick = () => runConnection(async () => { await api('/api/google/calendar', {}); return '모아 전용 캘린더를 만들었습니다.'; });
$('meta-config').onclick = () => runConnection(async () => {
  try { await api('/api/meta/config', { ig_id: $('meta-id').value.trim(), version: $('meta-version').value.trim(), token: $('meta-token').value.trim() }); return '새 Meta 계정 조회에 성공하고 암호화 저장했습니다.'; }
  finally { $('meta-token').value = ''; }
});
$('watch-add').onclick = () => runConnection(async () => { await api('/api/meta/accounts', { username: $('watch-username').value }); $('watch-username').value = ''; return '계정 조회를 확인했습니다. 자동 수집을 켜거나 지금 수집을 선택하세요.'; });
$('google-publish').onclick = async () => {
  $('google-publish').disabled = true;
  try {
    const r = await api(`/api/analyses/${current.id}/google`, { confirmed: true });
    message(r.reused ? '이미 등록된 일정입니다. 중복 생성하지 않았습니다.' : '모아 전용 Google 캘린더에 일정을 등록했습니다.');
  } catch (e) { message(e.message); }
  finally { $('google-publish').disabled = false; }
};
connections().catch(e => connectionMessage(e.message));
