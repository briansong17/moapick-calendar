import {validDate} from './extraction.mjs';
import {koreanDay as seoulDay} from '../cloud/time.mjs';

// A post containing future/unknown dates is not a reliable historical boundary.
export function pastBoundary(result, today=seoulDay()) {
  const events=result?.events;
  return !!events?.length && !result.warnings?.length && events.some(e=>e.kind==='event' && !/(구성\s*공고|당선인\s*공고|명단\s*발표)/.test(e.title)) && events.every(e =>
    validDate(e.start_date) && validDate(e.end_date ?? e.start_date) &&
    (e.end_date ?? e.start_date)>=e.start_date && (e.end_date ?? e.start_date)<today &&
    !(e.needs_review ?? []).some(n=>!n.includes('시간대')));
}
