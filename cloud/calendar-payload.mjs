import {AppError,validDate} from '../lib/extraction.mjs';
import {googleEvent} from '../lib/google.mjs';
import {digest} from './security.mjs';
export function calendarPayloads(uid,row,origin) {
  const reviewed=Array.isArray(row.reviewed),events=reviewed?row.reviewed:row.result?.events??[];
  const indices=reviewed?(row.source_indices??events.map((_,i)=>i)):events.map((_,i)=>i);
  const blocked=[],payloads=[];
  for(const [i,event] of events.entries()) {
    const index=indices[i];
    if(row.deleted_indices?.includes(index))continue;
    if(!Number.isInteger(index)||index<0||index>99)throw new AppError('일정 연결 정보를 확인하세요.');
    if(!validDate(event.start_date)){blocked.push(index);continue;}
    const value={...event};let provisional=false;
    if(!reviewed){
      value.title='(검토 필요) '+event.title.replace(/^\(검토 필요\)\s*/, '');
      if(!['Asia/Seoul','UTC'].includes(value.timezone)||!value.end_time||!value.start_time){
        provisional=!!value.start_time;value.start_time=null;value.end_time=null;value.timezone='Asia/Seoul';
      }
      if(!validDate(value.end_date)||value.end_date<value.start_date)value.end_date=value.start_date;
    }
    const payload=googleEvent(value,digest(`moa:${uid}:${row.id}:${index}`),row.metadata.source_url);
    payload.description=[reviewed?'모아에서 검토 완료':'AI 추출 초안입니다. 원문을 확인하세요.',
      provisional?`시간 미확정으로 날짜에만 임시 표시합니다. 추출 시작: ${event.start_time}, 종료: ${event.end_time??'불명'}, 시간대: ${event.timezone??'불명'}`:null,
      !reviewed?[...(row.result?.warnings??[]),...(event.needs_review??[])].join('\n'):null,
      payload.description,`모아에서 검토: ${origin}/?analysis=${row.id}`].filter(Boolean).join('\n\n');
    payload.extendedProperties.private.moaReview=reviewed?'complete':'required';
    // Drafts never send reminders or invitations.
    payload.reminders={useDefault:false};payloads.push(payload);
  }
  return {payloads,blocked,reviewed};
}
