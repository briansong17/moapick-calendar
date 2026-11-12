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
function invalidate() { $('confirmed').checked = false; $('download').hidden = true; $('result-badge').textContent = '검토 중'; }
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
