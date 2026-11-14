export const koreanDay=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const memberAnalysisBucket=(uid,date=new Date())=>'user-analysis:'+uid+':'+koreanDay(date);
