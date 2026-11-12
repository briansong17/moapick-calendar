import {AppError} from '../lib/extraction.mjs';
export function eventEntries(row){
 const events=row.reviewed??row.result?.events??[],indices=row.source_indices??events.map((_,i)=>i),deleted=new Set(row.deleted_indices??[]);
 return events.flatMap((event,i)=>deleted.has(indices[i])?[]:[{analysis_id:row.id,index:indices[i],event,reviewed:Array.isArray(row.reviewed)}]);
}
export function deletionIndices(input,row){
 if(input.confirmed!==true||!Array.isArray(input.indices)||!input.indices.length||input.indices.length>100)throw new AppError('삭제할 일정을 선택하고 확인해 주세요.');
 const valid=new Set([...(row.source_indices??(row.reviewed??row.result?.events??[]).map((_,i)=>i)),...(row.deleted_indices??[])]);
 if(input.indices.some(i=>!Number.isInteger(i)||!valid.has(i)))throw new AppError('삭제할 일정 연결 정보가 올바르지 않습니다.');
 return [...new Set(input.indices)];
}
