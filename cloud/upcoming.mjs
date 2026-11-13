// A date-only event remains eligible through its final local day. Timed events
// remain eligible until their end, including events currently in progress.
export function upcomingPayload(payload,now=new Date()){
 if(payload.end?.dateTime)return Date.parse(payload.end.dateTime)>now.getTime();
 if(payload.end?.date){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);return payload.end.date>today;}
 return false;
}
