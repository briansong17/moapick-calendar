import {AppError} from '../lib/extraction.mjs';

const boundary=value=>value?.date?{date:value.date}:value?.dateTime?{instant:Date.parse(value.dateTime),timeZone:value.timeZone??null}:null;
const managed=value=>({
  summary:value?.summary??'',description:value?.description??'',location:value?.location??'',
  start:boundary(value?.start),end:boundary(value?.end),
  moa:value?.extendedProperties?.private?.moa??null,
  review:value?.extendedProperties?.private?.moaReview??null,
  reminders:{useDefault:value?.reminders?.useDefault??true,overrides:value?.reminders?.overrides??[]}
});

export const sameManagedEvent=(actual,expected)=>actual?.status!=='cancelled'&&JSON.stringify(managed(actual))===JSON.stringify(managed(expected));

// This verifies Google's state, not whether a phone has downloaded the change.
export async function verifyGoogleEvent(call,path,{expected,deleted=false,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  for(let attempt=0;attempt<3;attempt++){
    let actual;
    try{actual=await call(path);}catch(error){
      if(![404,410].includes(error.status))throw error;
      if(deleted)return;
    }
    if(deleted?actual?.status==='cancelled':actual&&sameManagedEvent(actual,expected))return actual;
    if(attempt<2)await wait(250*(attempt+1));
  }
  throw new AppError(deleted?'Google 삭제 결과가 아직 확인되지 않았습니다. 자동으로 다시 확인합니다.':'Google 저장 결과가 아직 일치하지 않습니다. 자동으로 다시 확인합니다.',502);
}
